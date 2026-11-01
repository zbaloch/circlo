import { spacerHeight } from '@/components/keyboard-spacer';

jest.mock('react-native-keyboard-controller', () => ({ useReanimatedKeyboardAnimation: () => ({ height: { value: 0 } }) }));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: jest.requireActual('react-native').View }, useAnimatedStyle: () => ({}) }));

describe('room under a bottom-pinned input', () => {
  it('is the keyboard’s full reported height (suggestion bar included) minus the safe area already left', () => {
    // iPhone: 336 pt keyboard with its suggestion bar, 34 pt home-indicator inset.
    expect(spacerHeight(-336, 34)).toBe(302);
    // Taller keyboards (emoji, other languages, third-party) get exactly their own height.
    expect(spacerHeight(-380, 34)).toBe(346);
    // Android reports positive heights on some versions; both signs work.
    expect(spacerHeight(290, 48)).toBe(242);
  });

  it('is zero with no keyboard, and never negative', () => {
    expect(spacerHeight(0, 34)).toBe(0);
    expect(spacerHeight(-10, 34)).toBe(0);
  });
});
