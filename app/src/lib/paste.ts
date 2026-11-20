/**
 * Pasting a copied image into a post or chat (owner request 2026-11-20), with no new permissions. On phones a text
 * field only takes text, so a "Paste" button appears beside the photo button while the clipboard holds an image:
 * - iPhone: Apple's own Paste button (UIPasteControl, expo-clipboard's ClipboardPasteButton), which reads the clipboard
 *   without the "Allow Paste?" prompt because the person tapped it.
 * - Android: reading the clipboard needs no permission; Android 13+ shows its own "pasted from your clipboard" note.
 * Only *whether* there is an image is checked beforehand; the image itself is read only after a tap. The web app
 * takes Ctrl/Cmd+V instead (paste.web.ts).
 */
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';

import type { PickedMedia } from './media';

/** A clipboard image's data URI split into its type and base64 (pure; exported for tests). */
export function parseImageData(data: string): { mime: 'image/png' | 'image/jpeg'; base64: string } | null {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/.exec(data);
  return m ? { mime: m[1] as 'image/png' | 'image/jpeg', base64: m[2] } : null;
}

/** Whether there's an image on the clipboard. Asks only that, never for the image, so no prompt or note appears. */
export async function clipboardHasImage(): Promise<boolean> {
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}

/**
 * A pasted image saved to the app's cache, like a photo from the library: it then goes through the same pipeline
 * (re-encoded, metadata removed) and is cleared with the other picked files (discardPicked).
 */
export async function savePasted(image: { data: string; size: { width: number; height: number } }): Promise<PickedMedia | null> {
  const parsed = parseImageData(image.data);
  if (!parsed) return null;
  const file = new File(Paths.cache, `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${parsed.mime === 'image/png' ? 'png' : 'jpg'}`);
  await file.write(parsed.base64, { encoding: 'base64' });
  return { uri: file.uri, type: 'image', width: image.size.width, height: image.size.height, mimeType: parsed.mime };
}

/** Reads the clipboard's image after the person tapped Paste (Android, and iPhones without Apple's Paste button). */
export async function readClipboardImage(): Promise<PickedMedia | null> {
  try {
    const image = await Clipboard.getImageAsync({ format: 'png' });
    return image ? await savePasted(image) : null;
  } catch {
    return null;
  }
}

/** Ctrl/Cmd+V of images: web only (paste.web.ts). */
export function usePastedImages(_onImages: (media: PickedMedia[]) => void): void {}
