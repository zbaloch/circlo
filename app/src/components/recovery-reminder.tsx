import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { listRecoveryMethods } from '@/lib/account';
import type { StoredAccount } from '@/lib/keystore';
import { BIOMETRIC, passkeySupported } from '@/lib/passkey';
import { usePalette } from '@/theme/use-palette';

const dismissedKey = (userId: string) => `circlo.recovery-reminder-dismissed.${userId}`;

/**
 * Home card for accounts without Face ID recovery (e.g. made before it existed) on phones that support it. Opens
 * Settings → Account recovery; can be dismissed, and Settings keeps the option.
 */
export function RecoveryReminder({ account }: { account: StoredAccount }) {
  const palette = usePalette();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!passkeySupported()) return;
    let cancelled = false;
    (async () => {
      if ((await SecureStore.getItemAsync(dismissedKey(account.userId)).catch(() => null)) === '1') return;
      const methods = await listRecoveryMethods().catch(() => null);
      if (!cancelled && methods && !methods.some((m) => m.kind === 'passkey')) setShow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [account.userId]);

  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    SecureStore.setItemAsync(dismissedKey(account.userId), '1').catch(() => undefined);
  };
  return (
    <View className="mx-4 my-2 flex-row items-center gap-3 rounded-2xl bg-primary-soft p-3 dark:bg-primary-soft-dark">
      <Icon name="key-outline" size={20} color={palette.primary} />
      <Pressable accessibilityRole="button" onPress={() => router.push('/recovery')} className="flex-1">
        <Text className="text-sm font-semibold text-ink dark:text-ink-dark">{`Turn on ${BIOMETRIC} recovery`}</Text>
        <Text className="text-sm text-muted dark:text-muted-dark">Get back in with {BIOMETRIC} if you forget your password.</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={dismiss} hitSlop={8}>
        <Icon name="close" size={20} color={palette.muted} />
      </Pressable>
    </View>
  );
}
