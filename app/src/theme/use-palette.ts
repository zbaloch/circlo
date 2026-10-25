import { useColorScheme } from 'react-native';

import { colors } from './tokens';

/** Raw colour values for APIs that can't take class names (navigation options, icon colours). */
export function usePalette() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    primary: dark ? colors.primary.dark : colors.primary.DEFAULT,
    surface: dark ? colors.surface.dark : colors.surface.DEFAULT,
    ink: dark ? colors.ink.dark : colors.ink.DEFAULT,
    muted: dark ? colors.muted.dark : colors.muted.DEFAULT,
    border: dark ? colors.border.dark : colors.border.DEFAULT,
    danger: dark ? colors.danger.dark : colors.danger.DEFAULT,
  };
}
