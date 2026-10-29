import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CircloSymbol } from '@/components/circlo-mark';
import { Button } from '@/components/form';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { dismissPushPrompt, enablePush } from '@/lib/push';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

/**
 * Asks about notifications before the system popup, which iOS and Android show only once: the popup follows only a
 * "yes" here, and "Not now" leaves it unused so the user can still turn notifications on later from Settings.
 */
export default function EnableNotificationsScreen() {
  const session = useSession();
  const palette = usePalette();
  const [busy, setBusy] = useState(false);
  const account = session.status === 'signedIn' ? session.account : null;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const enable = async () => {
    if (!account) return;
    setBusy(true);
    await enablePush(account).catch(() => undefined);
    dismissPushPrompt();
    close();
  };
  const notNow = () => {
    dismissPushPrompt();
    close();
  };

  return (
    <SafeAreaView className="flex-1 bg-surface px-6 dark:bg-surface-dark">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-8 py-6" showsVerticalScrollIndicator={false}>
        <PhonePreview />
        <View className="gap-3">
          <Text className="text-center text-3xl font-extrabold text-ink dark:text-ink-dark">Know when your people share</Text>
          <Text className="text-center text-base text-muted dark:text-muted-dark">
            Get a nudge when someone posts to you, replies, likes or sends a message.
          </Text>
        </View>
        <View className="flex-row gap-3 rounded-2xl bg-surface-raised p-4 dark:bg-surface-raised-dark">
          <Icon name="lock-closed-outline" size={20} color={palette.primary} />
          <Text className="flex-1 text-sm text-muted dark:text-muted-dark">
            Notifications never say who or what. They only say there’s something new, and it stays encrypted until you
            open Circlo.
          </Text>
        </View>
      </ScrollView>
      <View className="gap-1 pb-6 pt-3">
        <Button size="lg" label="Turn on notifications" loading={busy} onPress={enable} />
        <Pressable accessibilityRole="button" onPress={notNow} disabled={busy} className="items-center rounded-full py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
          <Text className="text-[15px] font-bold text-ink dark:text-ink-dark">Not now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** The top of a phone's lock screen with Circlo's notifications as they really look: no names, no content. */
function PhonePreview() {
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" className="items-center">
      <View className="w-64 gap-2 overflow-hidden rounded-t-[44px] border-4 border-b-0 border-border bg-surface-raised px-3 pb-6 pt-8 dark:border-border-dark dark:bg-surface-raised-dark">
        <Text className="pb-2 text-center text-5xl font-bold text-ink dark:text-ink-dark">9:41</Text>
        <NotificationCard when="now" />
        <View className="opacity-60">
          <NotificationCard when="12m ago" />
        </View>
      </View>
      <View className="h-px w-72 bg-border dark:bg-border-dark" />
    </View>
  );
}

function NotificationCard({ when }: { when: string }) {
  return (
    <View className="flex-row items-center gap-3 rounded-2xl bg-surface p-3 dark:bg-surface-dark">
      <View className="h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface dark:border-border-dark">
        <CircloSymbol />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-[13px] font-bold text-ink dark:text-ink-dark">Circlo</Text>
          <Text className="text-xs text-muted dark:text-muted-dark">{when}</Text>
        </View>
        <Text className="text-[13px] text-ink dark:text-ink-dark">You have new activity</Text>
      </View>
    </View>
  );
}
