import { Icon } from '@/components/ui/icon';
import { Image } from 'expo-image';
import { Text } from '@/components/ui/text';
import { router } from 'expo-router';
import type React from 'react';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Attachment } from '@/lib/media';
import { formatTime, openVideo } from '@/lib/video';
import { usePalette } from '@/theme/use-palette';

/**
 * A photo from storage. Download URLs are presigned and change on every fetch, so the image cache is keyed by the
 * file's object key instead: scrolling back or refreshing doesn't download it again.
 */
export function MediaImage({ objectKey, url, className, fit = 'cover' }: { objectKey: string; url: string; className: string; fit?: 'cover' | 'contain' }) {
  const palette = usePalette();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View className={`items-center justify-center bg-surface-raised dark:bg-surface-raised-dark ${className}`}>
        <Icon name="image-outline" size={22} color={palette.muted} accessibilityLabel="Couldn’t load the photo" />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: url, cacheKey: objectKey }}
      className={`bg-surface-raised dark:bg-surface-raised-dark ${className}`}
      contentFit={fit}
      transition={150}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * A video in a post or chat: its poster frame, a play button and its length (owner request 2026-11-08). Tapping opens
 * it full screen (app/video.tsx), where it plays with Circlo's own controls; nothing plays inside the timeline.
 */
export function VideoPoster({ video, className }: { video: Attachment; className: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Play video"
      onPress={() => {
        openVideo(video);
        router.push('/video');
      }}
      className="relative">
      <MediaImage objectKey={video.previewKey} url={video.previewUrl} className={className} />
      <View className="absolute inset-0 items-center justify-center">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-black/60">
          <Icon name="play" size={28} color="#FFFFFF" />
        </View>
      </View>
      {video.durationMs > 0 ? (
        <View className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5">
          <Text className="text-xs font-semibold text-white">{formatTime(video.durationMs / 1000)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// Shapes (width / height) a single photo snaps to, nearest first by ratio. Written out in full so Tailwind finds every
// class: a photo's own ratio can't be a class, and inline styles are only for animations.
const SHAPES: { ratio: number; className: string }[] = [
  { ratio: 1 / 2, className: 'aspect-[1/2]' },
  { ratio: 9 / 16, className: 'aspect-[9/16]' },
  { ratio: 2 / 3, className: 'aspect-[2/3]' },
  { ratio: 3 / 4, className: 'aspect-[3/4]' },
  { ratio: 4 / 5, className: 'aspect-[4/5]' },
  { ratio: 1, className: 'aspect-square' },
  { ratio: 5 / 4, className: 'aspect-[5/4]' },
  { ratio: 4 / 3, className: 'aspect-[4/3]' },
  { ratio: 3 / 2, className: 'aspect-[3/2]' },
  { ratio: 16 / 9, className: 'aspect-video' },
  { ratio: 2, className: 'aspect-[2/1]' },
  { ratio: 3, className: 'aspect-[3/1]' },
];

/**
 * How a post's only photo is shown (as on Bluesky): in its own shape, snapped to the nearest of SHAPES. A wide or square
 * photo fills the width; a tall one is as tall as the width and narrower, so it never takes over the timeline.
 * Unknown sizes show as 4:3. Pure.
 */
export function singlePhotoShape(width: number, height: number): { tall: boolean; className: string } {
  const ratio = width > 0 && height > 0 ? width / height : 4 / 3;
  const shape = SHAPES.reduce((best, s) => (Math.abs(Math.log(s.ratio / ratio)) < Math.abs(Math.log(best.ratio / ratio)) ? s : best));
  return { tall: shape.ratio < 1, className: shape.className };
}

/**
 * PLAN.md 2A media: one photo in its own shape (singlePhotoShape); 2 side by side, 3 as one large plus two stacked,
 * 4 as 2×2.
 */
export function MediaGrid({ media, onPress }: { media: Attachment[]; onPress?: (index: number) => void }) {
  const video = media.find((m) => m.type === 'video');
  if (video) return <VideoPoster video={video} className="aspect-video w-full rounded-2xl" />;
  const tiles = media.filter((m) => m.type === 'image');
  if (tiles.length === 0) return null;
  const tap = (i: number, child: React.ReactNode, extra = '') => (
    <Pressable key={tiles[i].objectKey} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1} of ${tiles.length}`} onPress={() => onPress?.(i)} className={extra}>
      {child}
    </Pressable>
  );
  if (tiles.length === 1) {
    const shape = singlePhotoShape(tiles[0].width, tiles[0].height);
    const photo = <MediaImage objectKey={tiles[0].objectKey} url={tiles[0].url} className="h-full w-full rounded-2xl" />;
    // A tall photo: a square's height, its own width, on the left.
    return shape.tall ? (
      <View className="aspect-square w-full flex-row">{tap(0, photo, `h-full ${shape.className}`)}</View>
    ) : (
      tap(0, photo, `w-full ${shape.className}`)
    );
  }
  const cell = (i: number) => tap(i, <MediaImage objectKey={tiles[i].previewKey} url={tiles[i].previewUrl} className="h-full w-full" />, 'flex-1');
  return (
    <View className="aspect-[16/9] w-full flex-row gap-0.5 overflow-hidden rounded-2xl">
      {tiles.length === 2 ? (
        <>
          {cell(0)}
          {cell(1)}
        </>
      ) : (
        <>
          <View className="flex-1 gap-0.5">
            {cell(0)}
            {tiles.length === 4 ? cell(2) : null}
          </View>
          <View className="flex-1 gap-0.5">
            {cell(1)}
            {cell(tiles.length === 4 ? 3 : 2)}
          </View>
        </>
      )}
    </View>
  );
}
