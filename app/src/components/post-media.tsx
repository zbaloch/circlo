import { Icon } from '@/components/ui/icon';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type React from 'react';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Attachment } from '@/lib/media';
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

function Player({ url, className }: { url: string; className: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} className={className} nativeControls contentFit="contain" />;
}

/** Poster frame with a play button; plays (streaming from storage) when tapped. */
export function VideoPlayer({ video, className }: { video: Attachment; className: string }) {
  const [playing, setPlaying] = useState(false);
  if (playing) return <Player url={video.url} className={`bg-black ${className}`} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Play video" onPress={() => setPlaying(true)} className="relative">
      <MediaImage objectKey={video.previewKey} url={video.previewUrl} className={className} />
      <View className="absolute inset-0 items-center justify-center">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-black/60">
          <Icon name="play" size={28} color="#FFFFFF" />
        </View>
      </View>
    </Pressable>
  );
}

/** PLAN.md 2A media grid: 1 full width, 2 side by side, 3 as one large plus two stacked, 4 as 2×2. */
export function MediaGrid({ media, onPress }: { media: Attachment[]; onPress?: (index: number) => void }) {
  const video = media.find((m) => m.type === 'video');
  if (video) return <VideoPlayer video={video} className="aspect-video w-full rounded-2xl" />;
  const tiles = media.filter((m) => m.type === 'image');
  if (tiles.length === 0) return null;
  const tap = (i: number, child: React.ReactNode, extra = '') => (
    <Pressable key={tiles[i].objectKey} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1} of ${tiles.length}`} onPress={() => onPress?.(i)} className={extra}>
      {child}
    </Pressable>
  );
  if (tiles.length === 1) return tap(0, <MediaImage objectKey={tiles[0].objectKey} url={tiles[0].url} className="aspect-[4/3] w-full rounded-2xl" />);
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
