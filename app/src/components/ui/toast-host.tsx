import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { pressToastAction, useToast } from '@/lib/toast';

import { Text } from './text';

/**
 * Renders the current toast (lib/toast.ts): a dark pill near the bottom, clear of the tab bar, with an optional action
 * on the right. Touches outside the pill go through to the screen below.
 */
export function ToastHost() {
  const toast = useToast();
  // The frame stays mounted so the pill can fade out.
  return (
    <SafeAreaView edges={['bottom']} pointerEvents="box-none" className="absolute inset-x-0 bottom-0">
      <View pointerEvents="box-none" className="mb-16 px-4">
        {toast ? (
          <Animated.View key={toast.id} entering={FadeInDown.duration(180)} exiting={FadeOut.duration(150)}>
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              className="flex-row items-center gap-3 rounded-xl bg-ink px-4 py-3 shadow-lg dark:bg-ink-dark">
              <Text className="flex-1 text-[15px] font-medium text-surface dark:text-surface-dark">{toast.message}</Text>
              {toast.action ? (
                <Pressable accessibilityRole="button" hitSlop={10} onPress={() => pressToastAction(toast)} className="active:opacity-60">
                  <Text className="text-[15px] font-bold text-surface underline dark:text-surface-dark">{toast.action.text}</Text>
                </Pressable>
              ) : null}
            </View>
          </Animated.View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
