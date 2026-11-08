import { Icon } from '@/components/ui/icon';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaImage } from '@/components/post-media';
import { viewerState } from '@/lib/feed-store';
import type { Attachment } from '@/lib/media';
import { Text } from '@/components/ui/text';
import { clampPan, doubleTapScale, MAX_ZOOM } from '@/lib/zoom';

/**
 * One photo in the viewer. Pinch or double-tap to zoom; while zoomed, dragging moves around the photo (up to its
 * edges) and swiping to the next photo waits until it's back to normal size (owner report 2026-11-08: a sideways drag
 * jumped to the next photo instead of moving the zoomed one). Swipe down to close, at normal size.
 */
function ZoomableImage({ media, width, height, onDismiss, onZoom }: { media: Attachment; width: number; height: number; onDismiss: () => void; onZoom: (zoomed: boolean) => void }) {
  const [zoomed, setZoomed] = useState(false);
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const dy = useSharedValue(0);

  const changed = (z: boolean) => {
    setZoomed(z);
    onZoom(z);
  };
  const settle = (to: number) => {
    'worklet';
    scale.value = withTiming(to);
    saved.value = to;
    if (to === 1) {
      x.value = withTiming(0);
      y.value = withTiming(0);
      savedX.value = 0;
      savedY.value = 0;
    }
    runOnJS(changed)(to > 1);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(MAX_ZOOM, saved.value * e.scale));
      x.value = clampPan(savedX.value, scale.value, width);
      y.value = clampPan(savedY.value, scale.value, height);
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
      settle(scale.value <= 1.05 ? 1 : scale.value);
    });
  // Zoomed: move around the photo in any direction.
  const move = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      x.value = clampPan(savedX.value + e.translationX, scale.value, width);
      y.value = clampPan(savedY.value + e.translationY, scale.value, height);
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });
  // Normal size: swipe down to close (sideways is left to the list, for the next photo).
  const dismiss = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY([-15, 15])
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      dy.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120) runOnJS(onDismiss)();
      else dy.value = withTiming(0);
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      settle(doubleTapScale(saved.value));
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value + dy.value }, { scale: scale.value }],
    opacity: 1 - Math.min(dy.value / 400, 0.6),
  }));
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, move, dismiss, doubleTap)}>
      <Animated.View style={[{ width, height }, style]}>
        <View className="flex-1 items-center justify-center">
          <MediaImage objectKey={media.objectKey} url={media.url} className="h-full w-full" fit="contain" />
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/** Full-screen media viewer (PLAN.md 2A): swipe between images, pinch or double-tap to zoom and drag to look around, swipe down to dismiss. */
export default function ViewerScreen() {
  const state = viewerState();
  // Sized to the space the viewer really has: on the web that's the app's centred column, not the browser window
  // (window-sized pages put the photo off to the side, out of view).
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [index, setIndex] = useState(state?.index ?? 0);
  // While a photo is zoomed, sideways drags move the photo, so the list doesn't page.
  const [zoomed, setZoomed] = useState(false);
  if (!state || state.media.length === 0) {
    router.back();
    return null;
  }
  return (
    <View className="flex-1 bg-black" onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      <StatusBar style="light" />
      {size ? (
      <FlatList
        data={state.media}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        initialScrollIndex={state.index}
        getItemLayout={(_, i) => ({ length: size.width, offset: size.width * i, index: i })}
        keyExtractor={(m) => m.objectKey}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / size.width))}
        renderItem={({ item }) => <ZoomableImage media={item} width={size.width} height={size.height} onDismiss={() => router.back()} onZoom={setZoomed} />}
      />
      ) : null}
      <SafeAreaView edges={['top']} className="absolute left-0 right-0 top-0">
        <View className="flex-row items-center justify-between px-3">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} className="h-11 w-11 items-center justify-center rounded-full bg-black/50">
            <Icon name="close" size={26} color="#FFFFFF" />
          </Pressable>
          {state.media.length > 1 ? (
            <Text className="rounded-full bg-black/50 px-3 py-1 text-white">
              {index + 1} / {state.media.length}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}
