import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { SWIPE_REPLY, swipeOffset, swipeReplies } from '@/lib/swipe';

function tick() {
  Haptics.selectionAsync().catch(() => {});
}

/**
 * A chat message that can be pulled to the right to reply to it (as in WhatsApp): a reply arrow fades in behind it, the
 * phone ticks once at the reply point, and letting go there starts the reply. Up and down stays with the list. Phones
 * only: on the web the message's menu has Reply.
 */
export function SwipeToReply({ enabled, onReply, color, children }: { enabled: boolean; onReply: () => void; color: string; children: ReactNode }) {
  const x = useSharedValue(0);
  const armed = useSharedValue(false);
  const pan = Gesture.Pan()
    .enabled(enabled && Platform.OS !== 'web')
    // Starts only when moving right; a mostly vertical move scrolls the chat instead.
    .activeOffsetX(12)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      x.value = swipeOffset(e.translationX);
      const reached = swipeReplies(e.translationX);
      if (reached && !armed.value) runOnJS(tick)();
      armed.value = reached;
    })
    .onEnd(() => {
      if (armed.value) runOnJS(onReply)();
    })
    .onFinalize(() => {
      armed.value = false;
      x.value = withTiming(0, { duration: 180 });
    });

  const move = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const arrow = useAnimatedStyle(() => ({
    opacity: Math.min(x.value / SWIPE_REPLY, 1),
    transform: [{ scale: 0.6 + 0.4 * Math.min(x.value / SWIPE_REPLY, 1) }],
  }));
  return (
    <GestureDetector gesture={pan}>
      <View>
        <View className="pointer-events-none absolute bottom-0 left-1 top-0 justify-center">
          <Animated.View style={arrow}>
            <Icon name="arrow-undo-outline" size={20} color={color} />
          </Animated.View>
        </View>
        <Animated.View style={move}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}
