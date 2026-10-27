import '../global.css';
import '@/lib/interop';

import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppDrawer } from '@/components/app-drawer';
import { DialogHost } from '@/components/ui/dialog-host';
import { BackButton, HeaderBar } from '@/components/ui/header';
import { Spinner } from '@/components/ui/spinner';
import { SessionProvider, useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

// Keep the splash screen up until the bundled fonts are ready, so text never flashes in the system font.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Signed-out users only reach the onboarding stack; signed-in users get the drawer + tabs. */
function Navigator() {
  const session = useSession();
  const palette = usePalette();
  if (session.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark">
        <Spinner size="large" />
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
      // Back returns to the previous screen (thread → viewer → thread), not always to the first route.
      backBehavior="history"
      screenOptions={{
        swipeEnabled: signedIn,
        drawerType: 'front',
        overlayColor: 'rgba(0,0,0,0.4)',
        // Same header everywhere (components/ui/header.tsx) instead of the platform's native one.
        header: ({ options }) => (
          <HeaderBar title={options.title} left={<BackButton />} right={options.headerRight?.({ tintColor: palette.ink, canGoBack: true })} />
        ),
      }}>
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
        <Drawer.Screen name="compose" options={{ headerShown: false, swipeEnabled: false }} />
        <Drawer.Screen name="post/[id]" options={{ title: 'Post' }} />
        <Drawer.Screen name="viewer" options={{ headerShown: false, swipeEnabled: false }} />
        <Drawer.Screen name="preview/[id]" options={{ title: 'Preview' }} />
        <Drawer.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        <Drawer.Screen name="new-message" options={{ title: 'New message' }} />
        <Drawer.Screen name="link-confirm" options={{ title: 'Link a device' }} />
      </Drawer.Protected>
    </Drawer>
  );
}

export default function RootLayout() {
  const palette = usePalette();
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  const base = palette.dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: palette.primary, background: palette.surface, card: palette.surface, text: palette.ink, border: palette.border },
  };

  if (!ready) return null;

  return (
    <GestureHandlerRootView className="flex-1">
      <ThemeProvider value={theme}>
        <SessionProvider>
          <Navigator />
          <DialogHost />
        </SessionProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
