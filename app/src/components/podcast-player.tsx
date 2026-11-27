import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { IconButton } from '@/components/icon-button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  BACK_SECONDS,
  FORWARD_SECONDS,
  clock,
  lengthLabel,
  nextRate,
  playEpisode,
  rateLabel,
  savedPosition,
  seekTo,
  setRate,
  skip,
  toggle,
  usePodcastPlayer,
  type Episode,
} from '@/lib/podcast-player';
import { usePalette } from '@/theme/use-palette';

/** The episode's artwork, or a headphones tile when it has none. */
function Artwork({ uri, className }: { uri: string | null; className: string }) {
  const palette = usePalette();
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View className={`items-center justify-center bg-surface-raised dark:bg-surface-raised-dark ${className}`}>
        <Icon name="headphones-outline" size={28} color={palette.muted} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      accessibilityIgnoresInvertColors
      contentFit="cover"
      onError={() => setFailed(true)}
      className={`bg-surface-raised dark:bg-surface-raised-dark ${className}`}
    />
  );
}

/**
 * A podcast episode's player, on its screen in Feeds: artwork, a bar to see and move where you are, back 15 s, play or
 * pause, forward 30 s, and the speed. It plays from the podcast's own server, and says so.
 */
export function EpisodePlayer({ episode }: { episode: Episode }) {
  const palette = usePalette();
  const player = usePodcastPlayer();
  const current = player.episode?.articleId === episode.articleId;
  const [saved, setSaved] = useState(0);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let live = true;
    savedPosition(episode.articleId).then((s) => live && setSaved(s));
    return () => {
      live = false;
    };
  }, [episode.articleId, current]);

  const position = current ? player.position : saved;
  const duration = current && player.duration > 0 ? player.duration : (episode.durationSeconds ?? 0);
  const playing = current && player.playing;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const label = playing ? 'Pause' : current || saved > 0 ? 'Resume' : 'Play';

  const onBar = (e: GestureResponderEvent) => {
    if (!current || width <= 0 || duration <= 0) return;
    seekTo((e.nativeEvent.locationX / width) * duration);
  };

  return (
    <View className="items-center gap-5">
      <Artwork uri={episode.artwork} className="h-56 w-56 rounded-2xl" />
      <View className="w-full gap-1.5">
        <Pressable
          testID="episode-progress"
          accessibilityRole="adjustable"
          accessibilityLabel="Position"
          accessibilityValue={{ text: `${clock(position)} of ${duration > 0 ? clock(duration) : 'unknown'}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            if (!current) return;
            skip(e.nativeEvent.actionName === 'increment' ? FORWARD_SECONDS : -BACK_SECONDS);
          }}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          onPress={onBar}
          className="justify-center py-2">
          <View className="h-1.5 w-full overflow-hidden rounded-full bg-border dark:bg-border-dark">
            <View className="h-full rounded-full bg-primary dark:bg-primary-dark" style={{ width: `${progress * 100}%` }} />
          </View>
        </Pressable>
        <View className="flex-row justify-between">
          <Text className="text-sm tabular-nums text-muted dark:text-muted-dark">{clock(position)}</Text>
          <Text className="text-sm tabular-nums text-muted dark:text-muted-dark">
            {duration > 0 ? `-${clock(Math.max(0, duration - position))}` : ''}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center justify-center gap-8">
        <IconButton accessibilityLabel={`Back ${BACK_SECONDS} seconds`} disabled={!current} onPress={() => skip(-BACK_SECONDS)}>
          <View className={`items-center ${current ? '' : 'opacity-40'}`}>
            <Icon name="skip-back" size={28} color={palette.ink} />
            <Text className="text-xs font-semibold text-ink dark:text-ink-dark">{BACK_SECONDS}</Text>
          </View>
        </IconButton>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ busy: current && player.buffering }}
          onPress={() => (current ? toggle() : void playEpisode(episode))}
          className="h-16 w-16 items-center justify-center rounded-full bg-primary active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark">
          <Icon name={playing ? 'pause' : 'play'} size={28} color={palette.onPrimary} />
        </Pressable>
        <IconButton accessibilityLabel={`Forward ${FORWARD_SECONDS} seconds`} disabled={!current} onPress={() => skip(FORWARD_SECONDS)}>
          <View className={`items-center ${current ? '' : 'opacity-40'}`}>
            <Icon name="skip-forward" size={28} color={palette.ink} />
            <Text className="text-xs font-semibold text-ink dark:text-ink-dark">{FORWARD_SECONDS}</Text>
          </View>
        </IconButton>
      </View>
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Speed ${rateLabel(player.rate)}`}
          accessibilityHint="Changes the playback speed"
          onPress={() => setRate(nextRate(player.rate))}
          className="rounded-full border border-border px-3 py-1 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
          <Text className="text-sm font-bold text-ink dark:text-ink-dark">{rateLabel(player.rate)}</Text>
        </Pressable>
        {episode.durationSeconds ? (
          <Text className="text-sm text-muted dark:text-muted-dark">{lengthLabel(episode.durationSeconds)}</Text>
        ) : null}
      </View>
      <Text className="text-center text-sm text-muted dark:text-muted-dark">Plays from the podcast’s own server.</Text>
    </View>
  );
}

/**
 * The playing episode, as a bar at the bottom of Feeds: artwork, title, show, play or pause. Tapping it opens the
 * episode. Hidden when nothing is loaded (or on that episode's own screen).
 */
export function MiniPlayer({ hideFor }: { hideFor?: string }) {
  const palette = usePalette();
  const player = usePodcastPlayer();
  const episode = player.episode;
  if (!episode || episode.articleId === hideFor) return null;
  const progress = player.duration > 0 ? Math.min(1, player.position / player.duration) : 0;
  return (
    <View className="border-t border-border bg-surface dark:border-border-dark dark:bg-surface-dark">
      <View className="h-0.5 w-full bg-border dark:bg-border-dark">
        <View className="h-full bg-primary dark:bg-primary-dark" style={{ width: `${progress * 100}%` }} />
      </View>
      <View className="flex-row items-center gap-3 px-4 py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${episode.title}, ${episode.sourceTitle}`}
          accessibilityHint="Opens the episode"
          onPress={() => router.push({ pathname: '/feeds/[id]', params: { id: episode.articleId } })}
          className="flex-1 flex-row items-center gap-3">
          <Artwork uri={episode.artwork} className="h-10 w-10 rounded-lg" />
          <View className="flex-1">
            <Text numberOfLines={1} className="text-[15px] font-semibold text-ink dark:text-ink-dark">
              {episode.title}
            </Text>
            <Text numberOfLines={1} className="text-sm text-muted dark:text-muted-dark">
              {episode.sourceTitle}
            </Text>
          </View>
        </Pressable>
        <IconButton accessibilityLabel={player.playing ? 'Pause' : 'Play'} onPress={toggle}>
          <Icon name={player.playing ? 'pause' : 'play'} size={24} color={palette.ink} />
        </IconButton>
      </View>
    </View>
  );
}
