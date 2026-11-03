import { colorScheme } from 'nativewind';
import { Appearance } from 'react-native';

// Dark mode is class-based (tailwind.config.js), so on web the `dark` class on <html> has to follow the OS setting.
function sync() {
  colorScheme.set(Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');
}

sync();
Appearance.addChangeListener(sync);
