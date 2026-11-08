import { Icon } from '@/components/ui/icon';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { Attachment } from '@/lib/media';
import { claim, newOwner, nowPlaying, release, setPlaying as setNowPlaying, useNowPlaying } from '@/lib/now-playing';
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
 * One place a video is shown (lib/now-playing): picks the video up where it is when this screen is in view, and hands
 * it on with its position when the screen goes out of view, so it carries on in the post you open and on Home when
 * you come back. Starting another video pauses this one.
 */
/** Moves the player to `seconds` (outside the component: the player is an object it doesn't own). */
function seek(player: ReturnType<typeof useVideoPlayer>, seconds: number) {
  player.currentTime = seconds;
}

function Player({ video, owner, tapped, className }: { video: Attachment; owner: number; tapped: boolean; className: string }) {
  const key = video.objectKey;
  const player = useVideoPlayer(video.url, (p) => {
    p.loop = false;
  });
  const current = useNowPlaying();

  // In view: take the video over, from where it got to (playing or paused as it was), or start it.
  useFocusEffect(
    useCallback(() => {
      const s = nowPlaying();
      if (s?.key === key && s.owner === 0) {
        seek(player, s.time);
        claim(key, owner, s.time);
        if (s.playing) player.play();
        else setNowPlaying(key, owner, false);
      } else if (tapped || !s || s.key !== key || s.owner === owner) {
        // Tapped here, or nothing else is showing it: play it here (from where it got to, if it's this video).
        if (s?.key === key) seek(player, s.time);
        claim(key, owner, player.currentTime);
        player.play();
      }
      return () => {
        release(key, owner, player.currentTime, player.playing);
        player.pause();
      };
    }, [key, owner, player, tapped]),
  );

  // Played or paused with the controls: playing here takes over from any other video.
  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      const s = nowPlaying();
      if (isPlaying && !(s?.key === key && s.owner === owner)) claim(key, owner, player.currentTime);
      else setNowPlaying(key, owner, isPlaying);
    });
    return () => sub.remove();
  }, [key, owner, player]);

  // Another video started (or this one moved to another screen): pause here.
  useEffect(() => {
    // Read it fresh: on the first run, this player has just taken over, after `current` was read.
    const s = nowPlaying();
    if (s && s.owner !== owner && s.owner !== 0 && player.playing) player.pause();
  }, [current, owner, player]);

  return <VideoView player={player} className={className} nativeControls contentFit="contain" />;
}

/** Poster frame with a play button; plays (streaming from storage) when tapped, or carries on if it's playing elsewhere. */
export function VideoPlayer({ video, className }: { video: Attachment; className: string }) {
  const [owner] = useState(newOwner);
  const [started, setStarted] = useState<'tap' | 'handed' | null>(null);
  const current = useNowPlaying();
  // Handed on from another screen (the timeline, the post): show the player, which picks it up.
  const handedOn = current?.key === video.objectKey && current.owner === 0;
  // Once shown, it stays: it keeps its place when the video moves to another screen and back.
  if (handedOn && !started) setStarted('handed');
  if (started || handedOn) return <Player video={video} owner={owner} tapped={started === 'tap'} className={`bg-black ${className}`} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Play video" onPress={() => setStarted('tap')} className="relative">
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
