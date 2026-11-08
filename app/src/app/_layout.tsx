import '../global.css';
import '@/lib/interop';
import '@/theme/color-scheme';
// Defines the background check task at start-up, as the OS may launch the app just to run it.
import '@/lib/background-check';

import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import {
  NotoNaskhArabic_400Regular,
  NotoNaskhArabic_500Medium,
  NotoNaskhArabic_600SemiBold,
  NotoNaskhArabic_700Bold,
} from '@expo-google-fonts/noto-naskh-arabic';
import {
  NotoNastaliqUrdu_400Regular,
  NotoNastaliqUrdu_500Medium,
  NotoNastaliqUrdu_600SemiBold,
  NotoNastaliqUrdu_700Bold,
} from '@expo-google-fonts/noto-nastaliq-urdu';
import { Lateef_400Regular, Lateef_500Medium, Lateef_600SemiBold, Lateef_700Bold, Lateef_800ExtraBold } from '@expo-google-fonts/lateef';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppFrame } from '@/components/app-frame';
import { DialogHost } from '@/components/ui/dialog-host';
import { BackButton, HeaderBar } from '@/components/ui/header';
import { Spinner } from '@/components/ui/spinner';
import { ToastHost } from '@/components/ui/toast-host';
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
  const insets = useSafeAreaInsets();
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
  // Screens with the standard header keep clear of Android's navigation bar: the app draws under it, and with the
  // three-button bar the end of a screen was hidden behind it. Its height is 0 where there is none. Screens that keep
  // clear themselves (tabs, the thread, chat, full-screen ones) don't use this.
  const page = (title: string) => ({ title, contentStyle: { backgroundColor: palette.surface, paddingBottom: insets.bottom } });
  // Keyed on the auth state: signing in or out drops all navigation history, so finished onboarding screens are
  // unmounted and can never be navigated back to.
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
      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn} redirectTo="/welcome">
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={page('Profile')} />
        <Stack.Screen name="circles" options={page('My Circles')} />
        <Stack.Screen name="invite" options={page('Invite someone')} />
        <Stack.Screen name="join" options={page('Got an invite?')} />
        <Stack.Screen name="devices" options={page('Devices')} />
        <Stack.Screen name="settings/index" options={page('Settings and privacy')} />
        <Stack.Screen name="settings/account" options={page('Your account')} />
        <Stack.Screen name="settings/storage" options={page('Storage')} />
        <Stack.Screen name="settings/notifications" options={page('Notifications')} />
        <Stack.Screen name="settings/privacy" options={page('Privacy and safety')} />
        <Stack.Screen name="settings/about" options={page('About Circlo')} />
        <Stack.Screen name="edit-profile" options={page('Edit profile')} />
        <Stack.Screen name="friend/[id]" options={page('Profile')} />
        <Stack.Screen name="scan" options={page('Scan code')} />
        <Stack.Screen name="circle/[n]" options={page('Circle')} />
        <Stack.Screen name="compose" options={own} />
        <Stack.Screen name="post/[id]" options={{ title: 'Post' }} />
        <Stack.Screen name="reply/[id]" options={own} />
        <Stack.Screen name="viewer" options={own} />
        <Stack.Screen name="video" options={{ ...own, animation: 'fade' }} />
        <Stack.Screen name="preview/[id]" options={page('What they can see')} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        <Stack.Screen name="new-message" options={page('New message')} />
        <Stack.Screen name="report/[id]" options={page('Report')} />
        <Stack.Screen name="enable-notifications" options={own} />
        <Stack.Screen name="security-alert" options={own} />
        <Stack.Screen name="intro" options={own} />
        <Stack.Screen name="change-password" options={page('Change password')} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const palette = usePalette();
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold,
    // Arabic-script posts (lib/script): Lateef for Sindhi, Naskh for Arabic, Nastaliq for Urdu and Persian. All bundled:
    // the files ship in the app, so Google never sees a request.
    Lateef_400Regular, Lateef_500Medium, Lateef_600SemiBold, Lateef_700Bold, Lateef_800ExtraBold,
    NotoNaskhArabic_400Regular, NotoNaskhArabic_500Medium, NotoNaskhArabic_600SemiBold, NotoNaskhArabic_700Bold,
    NotoNastaliqUrdu_400Regular, NotoNastaliqUrdu_500Medium, NotoNastaliqUrdu_600SemiBold, NotoNastaliqUrdu_700Bold,
  });
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
          {/* On the web: a centred column instead of the full browser width. Phones: full screen, unchanged. */}
          <AppFrame>
            <Navigator />
            <ToastHost />
          </AppFrame>
          <DialogHost />
        </SessionProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
