// Phones: NativeWind follows the OS light/dark setting by itself, unless Settings → Display picks Light or Dark
// (lib/theme). The web build uses color-scheme.web.ts.
import { colorScheme } from 'nativewind';

import type { DarkTheme, ThemeChoice } from '@/lib/theme';

/** Light or Dark for the whole app, or back to the phone's own setting ('system'). */
export function applyScheme(choice: ThemeChoice): void {
  colorScheme.set(choice);
}

/** Phones get Dim or Dark from the CSS variables set at the app's root (app/_layout.tsx), so nothing to do here. */
export function applyDarkTheme(_theme: DarkTheme): void {}
