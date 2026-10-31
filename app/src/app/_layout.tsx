import '../global.css';
import '@/lib/interop';
// Defines the background check task at start-up, as the OS may launch the app just to run it.
import '@/lib/background-check';

import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { DialogHost } from '@/components/ui/dialog-host';
import { BackButton, HeaderBar } from '@/components/ui/header';
import { Spinner } from '@/components/ui/spinner';
import { SessionProvider, useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

// Keep the splash screen up until the bundled fonts are ready, so text never flashes in the system font.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Signed-out users only reach the onboarding stack. Signed-in users get the drawer + tabs ((drawer)), with every other
 * screen pushed on this stack above them: back (the header arrow, Android's back, iOS's left-edge swipe) returns to the
 * previous screen, and the drawer only opens on the tabs.
 */
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
  // Screens with their own Cancel or close button: no swipe, so a half-finished post or reply isn't dismissed by accident.
  const own = { headerShown: false, gestureEnabled: false };
  // Keyed on the auth state: signing in or out drops all navigation history, so finished onboarding screens
  // (including the recovery phrase) are unmounted and can never be navigated back to.
  return (
    <Stack
      key={signedIn ? 'signed-in' : 'signed-out'}
      screenOptions={{
        contentStyle: { backgroundColor: palette.surface },
        // Same header everywhere (components/ui/header.tsx) instead of the platform's native one.
        header: ({ options }) => (
          <HeaderBar title={options.title} left={<BackButton />} right={options.headerRight?.({ tintColor: palette.ink, canGoBack: true })} />
        ),
      }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="circles" options={{ title: 'Circles' }} />
        <Stack.Screen name="devices" options={{ title: 'Devices' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="recovery" options={{ title: 'Account recovery' }} />
        <Stack.Screen name="dev" options={{ title: 'Crypto self-test' }} />
        <Stack.Screen name="edit-profile" options={{ title: 'Edit profile' }} />
        <Stack.Screen name="friend/[id]" options={{ title: 'Profile' }} />
        <Stack.Screen name="safety/[id]" options={{ title: 'Safety number' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan code' }} />
        <Stack.Screen name="circle/[n]" options={{ title: 'Circle' }} />
        <Stack.Screen name="compose" options={own} />
        <Stack.Screen name="post/[id]" options={{ title: 'Post' }} />
        <Stack.Screen name="reply/[id]" options={own} />
        <Stack.Screen name="viewer" options={own} />
        <Stack.Screen name="preview/[id]" options={{ title: 'What they can see' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        <Stack.Screen name="new-message" options={{ title: 'New message' }} />
        <Stack.Screen name="link-confirm" options={{ title: 'Link a device' }} />
        <Stack.Screen name="report/[id]" options={{ title: 'Report' }} />
        <Stack.Screen name="enable-notifications" options={own} />
        <Stack.Screen name="security-alert" options={own} />
        <Stack.Screen name="change-password" options={{ title: 'Change password' }} />
      </Stack.Protected>
    </Stack>
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
      {/* Keyboard handling that works with Android's edge-to-edge layout (where window resizing no longer happens). */}
      <KeyboardProvider>
      <ThemeProvider value={theme}>
        <SessionProvider>
          <Navigator />
          <DialogHost />
        </SessionProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
