import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { decryptedUri, startPlayback, type UploadedMedia } from '@/lib/media';
import { usePalette } from '@/theme/use-palette';

/** An image decrypted on the device into the private cache. Shimmer while decrypting; lock icon if it can't be opened. */
export function EncryptedImage({ media, className }: { media: UploadedMedia; className: string }) {
  const palette = usePalette();
  const [uri, setUri] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    decryptedUri(media).then(
      (u) => live && setUri(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [media]);
  if (uri) return <Image source={{ uri }} className={className} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <View className={`items-center justify-center bg-surface-raised dark:bg-surface-raised-dark ${className}`}>
      {failed ? <Ionicons name="lock-closed" size={22} color={palette.muted} accessibilityLabel="Couldn't decrypt" /> : <ActivityIndicator />}
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
export function MediaGrid({ media }: { media: UploadedMedia[] }) {
  const video = media.find((m) => m.kind === 'full' && m.item.mime.startsWith('video/'));
  if (video) {
    return <EncryptedVideo video={video} poster={media.find((m) => m.kind === 'poster')} className="aspect-video w-full rounded-2xl" />;
  }
  const thumbs = media.filter((m) => m.kind === 'thumb');
  const tiles = thumbs.length ? thumbs : media.filter((m) => m.kind === 'full');
  if (tiles.length === 0) return null;
  if (tiles.length === 1) return <EncryptedImage media={media.find((m) => m.kind === 'full') ?? tiles[0]} className="aspect-[4/3] w-full rounded-2xl" />;
  const cell = (m: UploadedMedia, extra = '') => <EncryptedImage key={m.objectKey} media={m} className={`flex-1 ${extra}`} />;
  return (
    <View className="aspect-[16/9] w-full flex-row gap-0.5 overflow-hidden rounded-2xl">
      {tiles.length === 2 ? (
        <>
          {cell(tiles[0])}
          {cell(tiles[1])}
        </>
      ) : (
        <>
          <View className="flex-1 gap-0.5">
            {cell(tiles[0])}
            {tiles.length === 4 ? cell(tiles[2]) : null}
          </View>
          <View className="flex-1 gap-0.5">
            {cell(tiles[1])}
            {cell(tiles.length === 4 ? tiles[3] : tiles[2])}
          </View>
        </>
      )}
    </View>
  );
}
