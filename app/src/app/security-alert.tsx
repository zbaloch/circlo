import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/form';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { fullTime } from '@/lib/time';
import { markSignInsSeen, newSignIns, type SignIn } from '@/lib/security-events';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

/**
 * "New sign-in to your account": opened from Home when the server recorded a password login this phone hasn't shown
 * yet. Nothing about the other device is known (by design), only when it happened.
 */
export default function SecurityAlertScreen() {
  const session = useSession();
  const palette = usePalette();
  const account = session.status === 'signedIn' ? session.account : null;
  const [signIns, setSignIns] = useState<SignIn[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (account) newSignIns(account).then(setSignIns, () => undefined);
    }, [account]),
  );

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const itWasMe = async () => {
    if (account) await markSignInsSeen(account, signIns);
    close();
  };
  const secure = async () => {
    // Shown again only if the password isn't changed; changing it signs the other device out.
    if (account) await markSignInsSeen(account, signIns);
    router.replace('/change-password');
  };

  const latest = signIns[signIns.length - 1];
  return (
    <SafeAreaView className="flex-1 bg-surface px-6 dark:bg-surface-dark">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-8 py-6" showsVerticalScrollIndicator={false}>
        <View className="items-center">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark">
            <Icon name="shield-checkmark-outline" size={40} color={palette.primary} />
          </View>
        </View>
        <View className="gap-3">
          <Text accessibilityRole="header" className="text-center text-3xl font-extrabold text-ink dark:text-ink-dark">
            New sign-in to your account
          </Text>
          <Text className="text-center text-base text-muted dark:text-muted-dark">
            {signIns.length > 1 ? `Your password was used to sign in on another device ${signIns.length} times, most recently` : 'Your password was used to sign in on another device'}
            {latest ? ` at ${fullTime(Date.parse(latest.createdAt))}` : ''}. If that was you, there’s nothing to do.
          </Text>
        </View>
        <View className="flex-row gap-3 rounded-2xl bg-surface-raised p-4 dark:bg-surface-raised-dark">
          <Icon name="warning-outline" size={20} color={palette.primary} />
          <Text className="flex-1 text-sm text-muted dark:text-muted-dark">
            Not you? Change your password now. That signs out every other device, so whoever has your old password loses
            access straight away.
          </Text>
        </View>
      </ScrollView>
      <View className="gap-1 pb-6 pt-3">
        <Button size="lg" label="No, change my password" onPress={secure} />
        <Pressable accessibilityRole="button" onPress={itWasMe} className="items-center rounded-full py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
          <Text className="text-[15px] font-bold text-ink dark:text-ink-dark">Yes, it was me</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
