import { Appearance } from 'react-native';

import type { DarkTheme, ThemeChoice } from '@/lib/theme';

// Dark mode is class-based (tailwind.config.js), so on web the `dark` class on <html> has to follow the chosen theme
// (Settings → Display, lib/theme): Light, Dark, or the OS setting, the same source usePalette's useColorScheme()
// reads. Set here rather than through NativeWind's colorScheme.set(): its web runtime reads the dark-mode flag before
// the stylesheet loads, then removes the class itself once it does.
const root = globalThis.document?.documentElement;
let choice: ThemeChoice = 'system';

function sync() {
  const dark = choice === 'dark' || (choice === 'system' && Appearance.getColorScheme() === 'dark');
  if (root && root.classList.contains('dark') !== dark) root.classList.toggle('dark', dark);
}

if (root) {
  sync();
  Appearance.addChangeListener(sync);
  // Put the class back if anything else changes it.
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
}

/** Dim or Dark whenever the app is dark: the `dim` class on <html> switches the neutrals' CSS variables. */
export function applyDarkTheme(theme: DarkTheme): void {
  root?.classList.toggle('dim', theme === 'dim');
}

/** Light or Dark for the whole app, or back to the browser's own setting ('system'). */
export function applyScheme(next: ThemeChoice): void {
  choice = next;
  sync();
}
