import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Animated, type GestureResponderEvent, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Attachment } from '@/lib/media';
import { CONTROLS_HIDE_MS, formatTime, openedVideo, rememberMuted, soundMuted, timeAt } from '@/lib/video';

type Player = ReturnType<typeof useVideoPlayer>;

// The player is an object the screen doesn't own: it is changed through these, outside the component.
function seek(player: Player, seconds: number) {
  player.currentTime = seconds;
}
function mute(player: Player, muted: boolean) {
  player.muted = muted;
}

/** A swipe down further than this closes the viewer. */
const CLOSE_DRAG = 120;
/** A touch that moves less than this is a tap. */
const TAP_SLOP = 10;

/**
 * Full-screen video (owner request 2026-11-08), with Circlo's own controls instead of the phone's: a big play/pause
 * (play again at the end), a progress bar to drag, the time, and sound on/off, which is remembered for the next video.
 * The controls fade while it plays; a tap brings them back. Swipe down to close, as in the photo viewer.
 */
function VideoViewer({ video }: { video: Attachment }) {
  const player = useVideoPlayer(video.url, (p) => {
    p.loop = false;
    p.muted = soundMuted();
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });
  const [playing, setPlaying] = useState(() => player.playing);
  const [status, setStatus] = useState(() => player.status);
  const [muted, setMuted] = useState(() => player.muted);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(video.durationMs / 1000);
  const [ended, setEnded] = useState(false);
  // While the progress bar is being dragged: the time under the finger.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbing = useRef(false);
  const [shown, setShown] = useState(true);
  const [touched, setTouched] = useState(0);

  useEffect(() => {
    const subs = [
      player.addListener('playingChange', ({ isPlaying }) => {
        setPlaying(isPlaying);
        if (isPlaying) setEnded(false);
      }),
      player.addListener('statusChange', ({ status: next }) => {
        setStatus(next);
        if (player.duration > 0) setDuration(player.duration);
      }),
      player.addListener('timeUpdate', ({ currentTime }) => {
        if (!scrubbing.current) setTime(currentTime);
      }),
      player.addListener('playToEnd', () => {
        setEnded(true);
        setShown(true);
      }),
      player.addListener('mutedChange', ({ muted: next }) => setMuted(next)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  // Controls fade a moment after the last touch, while it plays; they stay while paused or being dragged.
  useEffect(() => {
    if (!shown || !playing || scrub !== null) return;
    const t = setTimeout(() => setShown(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(t);
  }, [shown, playing, scrub, touched]);
  const wake = () => {
    setShown(true);
    setTouched((n) => n + 1);
  };

  const [fade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    Animated.timing(fade, { toValue: shown ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [fade, shown]);

  // Tap the video to show or hide the controls; swipe it down to close.
  const [drag] = useState(() => new Animated.Value(0));
  const start = useRef({ x: 0, y: 0, moved: false });
  const area = {
    onStartShouldSetResponder: () => true,
    onResponderGrant: (e: GestureResponderEvent) => {
      start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, moved: false };
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const dx = e.nativeEvent.pageX - start.current.x;
      const dy = e.nativeEvent.pageY - start.current.y;
      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) start.current.moved = true;
      drag.setValue(Math.max(0, dy));
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      const dx = e.nativeEvent.pageX - start.current.x;
      const dy = e.nativeEvent.pageY - start.current.y;
      if (dy > CLOSE_DRAG) {
        router.back();
        return;
      }
      Animated.timing(drag, { toValue: 0, duration: 150, useNativeDriver: true }).start();
      if (!start.current.moved && Math.abs(dx) <= TAP_SLOP && Math.abs(dy) <= TAP_SLOP) {
        if (shown) setShown(false);
        else wake();
      }
    },
    onResponderTerminate: () => {
      Animated.timing(drag, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    },
  };

  // The progress bar: touch or drag anywhere along it.
  const barWidth = useRef(0);
  const grab = useRef({ x: 0, pageX: 0 });
  const scrubTo = (x: number) => {
    const t = timeAt(x, barWidth.current, duration);
    setScrub(t);
    seek(player, t);
    return t;
  };
  const bar = {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      grab.current = { x: e.nativeEvent.locationX, pageX: e.nativeEvent.pageX };
      scrubbing.current = true;
      scrubTo(grab.current.x);
      wake();
    },
    onResponderMove: (e: GestureResponderEvent) => {
      scrubTo(grab.current.x + e.nativeEvent.pageX - grab.current.pageX);
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      const t = scrubTo(grab.current.x + e.nativeEvent.pageX - grab.current.pageX);
      scrubbing.current = false;
      setTime(t);
      setScrub(null);
      setEnded(false);
      wake();
    },
    onResponderTerminate: () => {
      scrubbing.current = false;
      setScrub(null);
    },
  };

  const failed = status === 'error';
  const loading = !failed && (status === 'loading' || status === 'idle');
  const shownTime = scrub ?? time;
  const progress = duration > 0 ? Math.min(1, shownTime / duration) : 0;

  const toggle = () => {
    if (ended) player.replay();
    else if (playing) player.pause();
    else player.play();
    wake();
  };
  const toggleSound = () => {
    const next = !muted;
    mute(player, next);
    setMuted(next);
    rememberMuted(next);
    wake();
  };

  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" hidden={!shown} />
      <Animated.View className="flex-1" style={{ transform: [{ translateY: drag }], opacity: drag.interpolate({ inputRange: [0, 400], outputRange: [1, 0.4], extrapolate: 'clamp' }) }}>
        <VideoView player={player} className="flex-1" nativeControls={false} contentFit="contain" />
        <View testID="video-area" className="absolute inset-0" {...area} />
      </Animated.View>

      {loading ? (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <Spinner size="large" />
        </View>
      ) : null}
      {failed ? (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center px-8">
          <Text className="text-center text-base text-white">Couldn’t play this video.</Text>
        </View>
      ) : null}

      <Animated.View testID="video-controls" pointerEvents={shown ? 'box-none' : 'none'} className="absolute inset-0" style={{ opacity: fade }}>
        <SafeAreaView edges={['top']} pointerEvents="box-none">
          <View className="flex-row px-3" pointerEvents="box-none">
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} className="h-11 w-11 items-center justify-center rounded-full bg-black/50">
              <Icon name="close" size={26} color="#FFFFFF" />
            </Pressable>
          </View>
        </SafeAreaView>

        {!loading && !failed ? (
          <View className="absolute inset-0 items-center justify-center" pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ended ? 'Play again' : playing ? 'Pause' : 'Play'}
              onPress={toggle}
              className="h-16 w-16 items-center justify-center rounded-full bg-black/50 active:bg-black/70">
              <Icon name={ended ? 'replay' : playing ? 'pause' : 'play'} size={30} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null}

        <SafeAreaView edges={['bottom']} className="absolute bottom-0 left-0 right-0 bg-black/40" pointerEvents="box-none">
          <View className="flex-row items-center gap-3 px-4 py-2">
            <Text className="min-w-[40px] text-xs font-semibold text-white">{formatTime(shownTime)}</Text>
            <View
              testID="video-seek"
              accessibilityRole="adjustable"
              accessibilityLabel="Video position"
              accessibilityValue={{ text: `${formatTime(shownTime)} of ${formatTime(duration)}` }}
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={(e) => {
                const t = Math.min(duration, Math.max(0, time + (e.nativeEvent.actionName === 'increment' ? 5 : -5)));
                seek(player, t);
                setTime(t);
              }}
              onLayout={(e) => {
                barWidth.current = e.nativeEvent.layout.width;
              }}
              className="h-8 flex-1 justify-center"
              {...bar}>
              <View pointerEvents="none" className="h-1 w-full overflow-hidden rounded-full bg-white/30">
                {/* Widths follow the playing video, so they are set as it moves rather than with classes. */}
                <View className="h-full bg-primary-dark" style={{ width: `${progress * 100}%` }} />
              </View>
              <View
                pointerEvents="none"
                className={`absolute rounded-full bg-white ${scrub !== null ? '-ml-2 h-4 w-4' : '-ml-1.5 h-3 w-3'}`}
                style={{ left: `${progress * 100}%` }}
              />
            </View>
            <Text className="min-w-[40px] text-right text-xs font-semibold text-white">{formatTime(duration)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Sound on' : 'Mute'} onPress={toggleSound} hitSlop={8} className="h-9 w-9 items-center justify-center">
              <Icon name={muted ? 'volume-mute' : 'volume-high'} size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

/** Opened from a video's poster (components/post-media), which hands it over in memory (lib/video). */
export default function VideoScreen() {
  const [video] = useState(openedVideo);
  useEffect(() => {
    if (!video) router.back();
  }, [video]);
  return video ? <VideoViewer video={video} /> : null;
}
