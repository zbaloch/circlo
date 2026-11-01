import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Pure: the room to leave under a bottom-pinned input. Exported for tests. */
export function spacerHeight(keyboardHeight: number, bottomInset: number): number {
  'worklet';
  return Math.max(0, Math.abs(keyboardHeight) - bottomInset);
}

/**
 * Put last in a screen whose bottom edge sits on the safe area: grows with the keyboard, frame by frame, to exactly the
 * keyboard's height as the system reports it (suggestion bar, emoji and third-party keyboards included), minus the
 * inset the screen already leaves. No header-height guessing, so it is right on every phone, keyboard and orientation.
 * The web has no on-screen keyboard: it stays 0 there.
 */
export function KeyboardSpacer() {
  const { height } = useReanimatedKeyboardAnimation();
  const { bottom } = useSafeAreaInsets();
  const style = useAnimatedStyle(() => ({ height: spacerHeight(height.value, bottom) }));
  return <Reanimated.View style={style} />;
}
