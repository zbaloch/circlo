import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line } from 'react-native-svg';

import { CircloWordmark } from '@/components/circlo-mark';
import { Button } from '@/components/form';
import { svgA11y } from '@/components/ui/svg-a11y';
import { Text } from '@/components/ui/text';
import { INTRO_LAST_PAGE, introSeen, introStartPage, markIntroSeen } from '@/lib/intro';
import { usePalette } from '@/theme/use-palette';

type Art = 'crowd' | 'circles' | 'invite' | 'private';
export type IntroPage = { art: Art; title: string; lead: string; body: string };

/** What Circlo is, why, and how, before signing up (owner-approved 2026-11-07). */
export const INTRO_PAGES: IntroPage[] = [
  {
    art: 'crowd',
    title: 'The anti-social network',
    lead: 'Social media, without the crowd.',
    body: 'Circlo is for the people you actually know: no strangers, no followers to chase, no algorithm deciding what you see. Just your people’s posts, newest first.',
  },
  {
    art: 'circles',
    title: 'Your people, in circles',
    lead: 'Share with the right people.',
    body: 'Put people in circles like Family, Close Friends or Work. Post to one or several, and only the people in them see it. Nobody is told which circle they’re in, and replies stay in the circle they came from.',
  },
  {
    art: 'invite',
    title: 'Invite only',
    lead: 'Nobody can find you unless you let them.',
    body: 'There’s no search and no public profile. You connect by sharing your invite link or QR code, and choose each person’s circles when they join.',
  },
  {
    art: 'private',
    title: 'Private by design',
    lead: 'Your life isn’t the product.',
    body: 'No tracking, no advertising IDs, and your posts are never sold. Circlo is open source, so anyone can check.',
  },
];

/** A simple drawing per screen, made of circles in the brand colours. Decorative: the text says it all. */
function IntroArt({ art }: { art: Art }) {
  const p = usePalette();
  const W = 240;
  const H = 170;
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...svgA11y(undefined)}>
      {art === 'crowd' ? (
        <>
          {/* The crowd, faded, and your few people together in the middle. */}
          {[[20, 30], [60, 15], [200, 25], [225, 70], [30, 120], [15, 75], [210, 140], [180, 160], [55, 155], [100, 10], [150, 18], [226, 110]].map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={6} fill={p.muted} opacity={0.3} />
          ))}
          <Circle cx={120} cy={88} r={52} fill={p.primary} opacity={0.12} />
          <Circle cx={120} cy={88} r={52} stroke={p.primary} strokeWidth={3} fill="none" />
          {[[102, 72], [138, 72], [102, 104], [138, 104]].map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={10} fill={p.primary} />
          ))}
        </>
      ) : null}
      {art === 'circles' ? (
        <>
          {/* Overlapping circles: one person can be in several. */}
          <Circle cx={88} cy={70} r={50} fill={p.primary} opacity={0.18} stroke={p.primary} strokeWidth={2} />
          <Circle cx={152} cy={70} r={50} fill={p.primary} opacity={0.3} stroke={p.primary} strokeWidth={2} />
          <Circle cx={120} cy={118} r={50} fill={p.primary} opacity={0.12} stroke={p.primary} strokeWidth={2} />
          {[[70, 58], [168, 58], [120, 140], [120, 82]].map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={8} fill={p.primary} />
          ))}
        </>
      ) : null}
      {art === 'invite' ? (
        <>
          {/* You, someone you invite, and the link between you. */}
          <Line x1={80} y1={85} x2={138} y2={85} stroke={p.primary} strokeWidth={3} strokeDasharray="8 8" />
          <Circle cx={60} cy={85} r={40} fill={p.primary} opacity={0.15} />
          <Circle cx={60} cy={85} r={18} fill={p.primary} />
          <Circle cx={180} cy={85} r={40} fill="none" stroke={p.primary} strokeWidth={3} strokeDasharray="6 6" />
          <Circle cx={180} cy={85} r={18} fill={p.primary} opacity={0.6} />
        </>
      ) : null}
      {art === 'private' ? (
        <>
          {/* Your own space, ring inside ring. */}
          <Circle cx={120} cy={85} r={78} fill={p.primary} opacity={0.06} />
          <Circle cx={120} cy={85} r={60} fill={p.primary} opacity={0.1} />
          <Circle cx={120} cy={85} r={42} fill={p.primary} opacity={0.16} />
          <Circle cx={120} cy={85} r={42} fill="none" stroke={p.primary} strokeWidth={3} />
          <Circle cx={120} cy={85} r={16} fill={p.primary} />
        </>
      ) : null}
    </Svg>
  );
}

/**
 * The intro: four swipeable screens with dots, Skip and Next. `start` (signed out, replacing the old welcome page):
 * the first launch begins at screen 1, later ones on screen 4, whose buttons create an account or log in. `replay`
 * (About Circlo → Watch the intro again): from screen 1, Close at any time, ending with Done.
 */
export function Intro({ mode }: { mode: 'start' | 'replay' }) {
  const scroll = useRef<ScrollViewInstance>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState<number | null>(mode === 'replay' ? 0 : null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduceMotion, () => undefined);
    if (mode !== 'start') return;
    let live = true;
    introSeen().then(
      (seen) => {
        if (!live) return;
        setPage(introStartPage(seen));
        if (!seen) void markIntroSeen();
      },
      () => live && setPage(0),
    );
    return () => {
      live = false;
    };
  }, [mode]);

  const go = (to: number) => {
    setPage(to);
    scroll.current?.scrollTo({ x: to * width, animated: !reduceMotion });
  };
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(w);
    if (page) scroll.current?.scrollTo({ x: page * w, animated: false });
  };
  const onSwiped = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  if (page === null) return <View className="flex-1 bg-surface dark:bg-surface-dark" />;
  const last = page >= INTRO_LAST_PAGE;
  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="h-12 flex-row items-center justify-between px-6">
        <CircloWordmark height={24} />
        {mode === 'replay' ? (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => router.back()} className="active:opacity-60">
            <Text className="text-base font-semibold text-muted dark:text-muted-dark">Close</Text>
          </Pressable>
        ) : !last ? (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => go(INTRO_LAST_PAGE)} className="active:opacity-60">
            <Text className="text-base font-semibold text-muted dark:text-muted-dark">Skip</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        ref={scroll}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onLayout={onLayout}
        onMomentumScrollEnd={onSwiped}
        className="flex-1">
        {INTRO_PAGES.map((p) => (
          // Each page is the pager's measured width (as in the photo viewer): it can't be a class, the web frame varies.
          <View key={p.title} className="flex-1 items-center justify-center gap-6 px-8" style={width ? { width } : undefined}>
            <IntroArt art={p.art} />
            <View className="gap-3">
              <Text accessibilityRole="header" className="text-center text-3xl font-extrabold text-ink dark:text-ink-dark">{p.title}</Text>
              <Text className="text-center text-lg font-semibold text-ink dark:text-ink-dark">{p.lead}</Text>
              <Text className="text-center text-base leading-6 text-muted dark:text-muted-dark">{p.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <View className="gap-4 px-6 pb-6 pt-3">
        <View accessible accessibilityLabel={`Screen ${page + 1} of ${INTRO_PAGES.length}`} className="flex-row justify-center gap-2">
          {INTRO_PAGES.map((p, i) => (
            <View key={p.title} className={`h-2 rounded-full ${i === page ? 'w-6 bg-primary dark:bg-primary-dark' : 'w-2 bg-border dark:bg-border-dark'}`} />
          ))}
        </View>
        {!last ? (
          <Button size="lg" label="Next" onPress={() => go(page + 1)} />
        ) : mode === 'start' ? (
          <View className="gap-3">
            <Button size="lg" label="Create account" onPress={() => router.push('/signup')} />
            <Button size="lg" variant="outline" label="Log in" onPress={() => router.push('/login')} />
          </View>
        ) : (
          <Button size="lg" label="Done" onPress={() => router.back()} />
        )}
      </View>
    </SafeAreaView>
  );
}
