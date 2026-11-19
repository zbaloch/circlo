import { useColorScheme } from 'react-native';

import { resolveScheme, useDarkTheme, useThemeChoice } from '@/lib/theme';

import { colors, darkNeutrals } from './tokens';

/** Raw colour values for APIs that can't take class names (navigation options, icon colours). */
export function usePalette() {
  // The chosen theme (Settings → Display), or the device's own setting.
  const dark = resolveScheme(useThemeChoice(), useColorScheme()) === 'dark';
  // Dark or Dim: they differ only in the neutrals.
  const night = darkNeutrals[useDarkTheme()];
  return {
    dark,
    primary: dark ? colors.primary.dark : colors.primary.DEFAULT,
    onPrimary: dark ? colors['on-primary'].dark : colors['on-primary'].DEFAULT,
    surface: dark ? night.surface : colors.surface.DEFAULT,
    ink: dark ? night.ink : colors.ink.DEFAULT,
    muted: dark ? night.muted : colors.muted.DEFAULT,
    border: dark ? night.border : colors.border.DEFAULT,
    danger: dark ? colors.danger.dark : colors.danger.DEFAULT,
  };
}
