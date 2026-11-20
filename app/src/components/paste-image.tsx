import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Platform, Pressable } from 'react-native';

import { Icon } from '@/components/ui/icon';
import type { PickedMedia } from '@/lib/media';
import { clipboardHasImage, readClipboardImage, savePasted, usePastedImages } from '@/lib/paste';
import { usePalette } from '@/theme/use-palette';

/**
 * Paste, beside the photo button in a post or chat, shown while the clipboard holds an image (lib/paste). On iPhone
 * it's Apple's own Paste button, so no "Allow Paste?" prompt; on Android our own. Nothing on the web, which takes
 * Ctrl/Cmd+V.
 */
export function PasteImageButton({ onImages, disabled = false, className = '' }: { onImages: (media: PickedMedia[]) => void; disabled?: boolean; className?: string }) {
  const palette = usePalette();
  const [hasImage, setHasImage] = useState(false);
  // Checked when the screen comes up and whenever Circlo comes back to the front (after copying elsewhere).
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      const check = () => {
        clipboardHasImage().then(setHasImage);
      };
      check();
      const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
      return () => sub.remove();
    }, []),
  );
  if (Platform.OS === 'web' || !hasImage) return null;

  const take = (m: PickedMedia | null) => {
    if (m) onImages([m]);
  };
  if (Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable) {
    return (
      <Clipboard.ClipboardPasteButton
        accessibilityLabel="Paste image"
        acceptedContentTypes={['image']}
        imageOptions={{ format: 'png' }}
        displayMode="iconOnly"
        cornerStyle="capsule"
        backgroundColor={palette.surface}
        foregroundColor={palette.primary}
        onPress={(data) => {
          if (!disabled && data.type === 'image') savePasted(data).then(take, () => {});
        }}
        className={`h-9 w-9 ${disabled ? 'opacity-40' : ''}`}
      />
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Paste image"
      disabled={disabled}
      onPress={() => readClipboardImage().then(take)}
      className={`${className} ${disabled ? 'opacity-40' : 'active:opacity-60'}`}>
      <Icon name="clipboard-outline" size={24} color={palette.primary} />
    </Pressable>
  );
}

/** Takes Ctrl/Cmd+V of images while its screen is on top (web only; nothing on phones). */
export function PasteListener({ onImages }: { onImages: (media: PickedMedia[]) => void }) {
  usePastedImages(onImages);
  return null;
}
