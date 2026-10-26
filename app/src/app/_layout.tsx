import '../global.css';
import '@/lib/interop';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppDrawer } from '@/components/app-drawer';
import { SessionProvider, useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

/** Signed-out users only reach the onboarding stack; signed-in users get the drawer + tabs. */
function Navigator() {
  const session = useSession();
  const palette = usePalette();
  if (session.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark">
        <ActivityIndicator />
      </View>
    );
  }
  const signedIn = session.status === 'signedIn';
  // Keyed on the auth state: signing in or out drops all navigation history, so finished onboarding screens
  // (including the recovery phrase) are unmounted and can never be navigated back to.
  return (
    <Drawer
      key={signedIn ? 'signed-in' : 'signed-out'}
      drawerContent={(props) => <AppDrawer {...props} />}
      screenOptions={{ headerTintColor: palette.ink, swipeEnabled: signedIn }}>
      <Drawer.Protected guard={!signedIn} redirectTo="/">
        <Drawer.Screen name="(auth)" options={{ headerShown: false }} />
      </Drawer.Protected>
      <Drawer.Protected guard={signedIn} redirectTo="/welcome">
        <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
        <Drawer.Screen name="profile" options={{ title: 'Profile' }} />
        <Drawer.Screen name="circles" options={{ title: 'Circles' }} />
        <Drawer.Screen name="devices" options={{ title: 'Devices' }} />
        <Drawer.Screen name="settings" options={{ title: 'Settings' }} />
        <Drawer.Screen name="recovery" options={{ title: 'Recovery phrase' }} />
        <Drawer.Screen name="dev" options={{ title: 'Crypto self-test' }} />
        <Drawer.Screen name="edit-profile" options={{ title: 'Edit profile' }} />
        <Drawer.Screen name="friend/[id]" options={{ title: 'Friend' }} />
        <Drawer.Screen name="safety/[id]" options={{ title: 'Safety number' }} />
        <Drawer.Screen name="scan" options={{ title: 'Scan code' }} />
        <Drawer.Screen name="circle/[n]" options={{ title: 'Circle' }} />
      </Drawer.Protected>
    </Drawer>
  );
}

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
        <SessionProvider>
          <Navigator />
        </SessionProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
