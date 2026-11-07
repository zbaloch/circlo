import { Stack } from 'expo-router';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePalette } from '@/theme/use-palette';

/** Signed-out screens: welcome, sign up (+ email code), log in, forgot password. */
export default function AuthLayout() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTitle: '',
        headerTintColor: palette.ink,
        headerStyle: { backgroundColor: palette.surface },
        // Clear of Android's navigation bar (the app draws under it); the intro keeps clear itself.
        contentStyle: { backgroundColor: palette.surface, paddingBottom: insets.bottom },
      }}>
      <Stack.Screen name="welcome" options={{ headerShown: false, contentStyle: { backgroundColor: palette.surface } }} />
    </Stack>
  );
}
