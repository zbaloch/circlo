import '../global.css';
import '@/lib/interop';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppDrawer } from '@/components/app-drawer';
import { usePalette } from '@/theme/use-palette';

export default function RootLayout() {
  const palette = usePalette();
  const base = palette.dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: palette.primary, background: palette.surface, card: palette.surface, text: palette.ink, border: palette.border },
  };

  return (
    <GestureHandlerRootView className="flex-1">
      <ThemeProvider value={theme}>
        <Drawer drawerContent={(props) => <AppDrawer {...props} />} screenOptions={{ headerTintColor: palette.ink }}>
          <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
          <Drawer.Screen name="profile" options={{ title: 'Profile' }} />
          <Drawer.Screen name="circles" options={{ title: 'Circles' }} />
          <Drawer.Screen name="devices" options={{ title: 'Devices' }} />
          <Drawer.Screen name="settings" options={{ title: 'Settings' }} />
          <Drawer.Screen name="recovery" options={{ title: 'Recovery phrase' }} />
          <Drawer.Screen name="dev" options={{ title: 'Crypto self-test' }} />
        </Drawer>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
