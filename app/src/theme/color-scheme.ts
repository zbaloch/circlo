// Phones: NativeWind follows the OS light/dark setting by itself, unless Settings → Display picks Light or Dark
// (lib/theme). The web build uses color-scheme.web.ts.
import { colorScheme } from 'nativewind';

import type { ThemeChoice } from '@/lib/theme';

/** Light or Dark for the whole app, or back to the phone's own setting ('system'). */
export function applyScheme(choice: ThemeChoice): void {
  colorScheme.set(choice);
}
