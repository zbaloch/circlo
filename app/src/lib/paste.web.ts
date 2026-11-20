/**
 * Pasting a copied image in the web app: Ctrl/Cmd+V while a post or chat is on screen hands the image over, as the
 * browser does for any page, with no prompt. Phones use a Paste button instead (paste.ts).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import type { PickedMedia } from './media';

/** The images in a paste, and whether it also had text (pure; exported for tests). */
export function imagesInPaste(data: Pick<DataTransfer, 'files' | 'types'> | null): { files: File[]; hasText: boolean } {
  if (!data) return { files: [], hasText: false };
  const files = Array.from(data.files ?? []).filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
  return { files, hasText: Array.from(data.types ?? []).includes('text/plain') };
}

function picked(file: File): Promise<PickedMedia | null> {
  const uri = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ uri, type: 'image', width: img.naturalWidth, height: img.naturalHeight, mimeType: file.type });
    img.onerror = () => {
      URL.revokeObjectURL(uri);
      resolve(null);
    };
    img.src = uri;
  });
}

/** While the screen is on top, images pasted anywhere on it go to `onImages`; text pastes as usual. */
export function usePastedImages(onImages: (media: PickedMedia[]) => void): void {
  useFocusEffect(
    useCallback(() => {
      const onPaste = (e: ClipboardEvent) => {
        const { files, hasText } = imagesInPaste(e.clipboardData);
        if (files.length === 0) return;
        // An image copied from a page may come with text: let that text paste too.
        if (!hasText) e.preventDefault();
        Promise.all(files.map(picked)).then((media) => {
          const ok = media.filter((m): m is PickedMedia => m !== null);
          if (ok.length) onImages(ok);
        });
      };
      document.addEventListener('paste', onPaste);
      return () => document.removeEventListener('paste', onPaste);
    }, [onImages]),
  );
}

export function parseImageData(): null {
  return null;
}

/** The web app takes Ctrl/Cmd+V instead of a Paste button. */
export async function clipboardHasImage(): Promise<boolean> {
  return false;
}

export async function savePasted(): Promise<PickedMedia | null> {
  return null;
}

export async function readClipboardImage(): Promise<PickedMedia | null> {
  return null;
}
