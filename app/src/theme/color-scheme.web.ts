import { Appearance } from 'react-native';

// Dark mode is class-based (tailwind.config.js), so on web the `dark` class on <html> has to follow the OS setting, the
// same source usePalette's useColorScheme() reads. Set here rather than through NativeWind's colorScheme.set(): its web
// runtime reads the dark-mode flag before the stylesheet loads, then removes the class itself once it does.
const root = globalThis.document?.documentElement;

function sync() {
  const dark = Appearance.getColorScheme() === 'dark';
  if (root && root.classList.contains('dark') !== dark) root.classList.toggle('dark', dark);
}

if (root) {
  sync();
  Appearance.addChangeListener(sync);
  // Put the class back if anything else changes it.
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
}
