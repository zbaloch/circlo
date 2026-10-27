import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type React from 'react';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { imageUri, startPlayback, type UploadedMedia } from '@/lib/media';
import { usePalette } from '@/theme/use-palette';
import { Spinner } from './ui/spinner';

/** An image decrypted in memory on the device. Placeholder while decrypting; lock icon if it can't be opened. */
export function EncryptedImage({ media, className, fit = 'cover' }: { media: UploadedMedia; className: string; fit?: 'cover' | 'contain' }) {
  const palette = usePalette();
  const [uri, setUri] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    imageUri(media).then(
      (u) => live && setUri(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [media]);
  if (uri) return <Image source={{ uri }} className={className} contentFit={fit} accessibilityIgnoresInvertColors />;
  return (
    <View className={`items-center justify-center bg-surface-raised dark:bg-surface-raised-dark ${className}`}>
      {failed ? <Ionicons name="lock-closed" size={22} color={palette.muted} accessibilityLabel="Couldn't decrypt" /> : <Spinner />}
    </View>
  );
}

function Player({ url, className }: { url: string; className: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} className={className} nativeControls contentFit="contain" />;
}

/** Poster frame with a play button; playing streams through the core's loopback decryptor while chunks download. */
export function EncryptedVideo({ video, poster, className }: { video: UploadedMedia; poster?: UploadedMedia; className: string }) {
  const [playback, setPlayback] = useState<{ url: string; stop: () => void }>();
  useEffect(() => () => playback?.stop(), [playback]);
  if (playback) return <Player url={playback.url} className={`bg-black ${className}`} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Play video"
      onPress={() => setPlayback(startPlayback(video))}
      className="relative">
      {poster ? <EncryptedImage media={poster} className={className} /> : <View className={`bg-black ${className}`} />}
      <View className="absolute inset-0 items-center justify-center">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-black/60">
          <Ionicons name="play" size={28} color="#FFFFFF" />
        </View>
      </View>
    </Pressable>
  );
}

/** PLAN.md 2A media grid: 1 full width, 2 side by side, 3 as one large plus two stacked, 4 as 2×2. */
export function MediaGrid({ media, onPress }: { media: UploadedMedia[]; onPress?: (index: number) => void }) {
  const video = media.find((m) => m.kind === 'full' && m.item.mime.startsWith('video/'));
  if (video) {
    return <EncryptedVideo video={video} poster={media.find((m) => m.kind === 'poster')} className="aspect-video w-full rounded-2xl" />;
  }
  const thumbs = media.filter((m) => m.kind === 'thumb');
  const tiles = thumbs.length ? thumbs : media.filter((m) => m.kind === 'full');
  if (tiles.length === 0) return null;
  const tap = (i: number, child: React.ReactNode, extra = '') => (
    <Pressable key={tiles[i].objectKey} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1} of ${tiles.length}`} onPress={() => onPress?.(i)} className={extra}>
      {child}
    </Pressable>
  );
  if (tiles.length === 1) return tap(0, <EncryptedImage media={media.find((m) => m.kind === 'full') ?? tiles[0]} className="aspect-[4/3] w-full rounded-2xl" />);
  const cell = (i: number) => tap(i, <EncryptedImage media={tiles[i]} className="h-full w-full" />, 'flex-1');
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
