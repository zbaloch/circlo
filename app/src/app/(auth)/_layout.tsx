import { Stack } from 'expo-router';

import { usePalette } from '@/theme/use-palette';

/** Signed-out screens: welcome, sign up (+ recovery phrase), log in, recover. */
export default function AuthLayout() {
  const palette = usePalette();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTitle: '',
        headerTintColor: palette.ink,
        headerStyle: { backgroundColor: palette.surface },
        contentStyle: { backgroundColor: palette.surface },
      }}>
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="confirm-phrase" />
    </Stack>
  );
}
