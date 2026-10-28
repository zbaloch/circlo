import { Icon } from '@/components/ui/icon';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { FlatList, Pressable, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EncryptedImage } from '@/components/encrypted-media';
import { viewerState } from '@/lib/feed-store';
import type { UploadedMedia } from '@/lib/media';
import { Text } from '@/components/ui/text';

function ZoomableImage({ media, width, height, onDismiss }: { media: UploadedMedia; width: number; height: number; onDismiss: () => void }) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const dy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(5, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
    });
  // Swipe down to dismiss, only when not zoomed (so horizontal paging and zoomed panning still work).
  const pan = Gesture.Pan()
    .activeOffsetY([-15, 15])
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      if (saved.value === 1) dy.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (saved.value === 1 && e.translationY > 120) runOnJS(onDismiss)();
      else dy.value = withTiming(0);
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1);
      saved.value = 1;
    });

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: dy.value }, { scale: scale.value }], opacity: 1 - Math.min(dy.value / 400, 0.6) }));
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View className="items-center justify-center" style={[{ width, height }, style]}>
        <EncryptedImage media={media} className="h-full w-full" fit="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

/** Full-screen media viewer (PLAN.md 2A): swipe between images, pinch to zoom, swipe down to dismiss. */
export default function ViewerScreen() {
  const state = viewerState();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(state?.index ?? 0);
  if (!state || state.media.length === 0) {
    router.back();
    return null;
  }
  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" />
      <FlatList
        data={state.media}
        horizontal
        pagingEnabled
        initialScrollIndex={state.index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(m) => m.objectKey}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <ZoomableImage media={item} width={width} height={height} onDismiss={() => router.back()} />}
      />
      <SafeAreaView edges={['top']} className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-3">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} className="h-11 w-11 items-center justify-center rounded-full bg-black/50">
          <Icon name="close" size={26} color="#FFFFFF" />
        </Pressable>
        {state.media.length > 1 ? (
          <Text className="rounded-full bg-black/50 px-3 py-1 text-white">
            {index + 1} / {state.media.length}
          </Text>
        ) : null}
      </SafeAreaView>
    </View>
  );
}
