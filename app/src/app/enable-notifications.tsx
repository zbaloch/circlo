import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CircloSymbol } from '@/components/circlo-mark';
import { Button } from '@/components/form';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { CHAT_ENABLED } from '@/lib/features';
import { dismissNotificationsPrompt, enableBackgroundChecks, usesPush } from '@/lib/background-check';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

/**
 * Asks about notifications before the system popup, which iOS and Android show only once: the popup follows only a
 * "yes" here, and "Not now" leaves it unused so the user can still turn them on later from Settings and privacy › Notifications. A "yes" turns on
 * content-free push (iPhone and Android; background checks on an Android build without FCM; lib/background-check).
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
    await enableBackgroundChecks().catch(() => undefined);
    dismissNotificationsPrompt();
    close();
  };
  const notNow = () => {
    dismissNotificationsPrompt();
    close();
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-8 px-6 py-6" showsVerticalScrollIndicator={false}>
        <PhonePreview />
        <View className="gap-3">
          <Text className="text-center text-3xl font-extrabold text-ink dark:text-ink-dark">Know when something’s new</Text>
          <Text className="text-center text-base text-muted dark:text-muted-dark">
            {usesPush
              ? `Once a day, around 6pm, and only on days something happened, Circlo lets you know there are new replies${CHAT_ENABLED ? ', messages' : ''} or requests waiting.`
              : `Now and then Circlo checks for new replies${CHAT_ENABLED ? ', messages' : ''} and requests, and lets you know at most once a day.`}
          </Text>
        </View>
        <View className="flex-row gap-3 rounded-2xl bg-surface-raised p-4 dark:bg-surface-raised-dark">
          <Icon name="lock-closed-outline" size={20} color={palette.primary} />
          <Text className="flex-1 text-sm text-muted dark:text-muted-dark">
            {usesPush
              ? 'The notification only says “You have a few new things waiting”. Never who, what or how many: you see that when you open Circlo.'
              : 'Nothing goes through Apple or Google: your phone checks Circlo itself, and the notification never says who, what or how many. Your phone decides when to check, so it can take a while; Circlo is always up to date when you open it.'}
          </Text>
        </View>
      </ScrollView>
      <View className="gap-1 px-6 pb-6 pt-3">
        <Button size="lg" label="Turn on notifications" loading={busy} onPress={enable} />
        <Pressable accessibilityRole="button" onPress={notNow} disabled={busy} className="items-center rounded-full py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
          <Text className="text-[15px] font-bold text-ink dark:text-ink-dark">Not now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** The top of a phone's lock screen with Circlo's notification as it really looks: no names, content or counts. */
function PhonePreview() {
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" className="items-center">
      <View className="w-64 gap-2 overflow-hidden rounded-t-[44px] border-4 border-b-0 border-border bg-surface-raised px-3 pb-6 pt-8 dark:border-border-dark dark:bg-surface-raised-dark">
        <Text className="pb-2 text-center text-5xl font-bold text-ink dark:text-ink-dark">6:00</Text>
        <NotificationCard when="now" text="You have a few new things waiting. Catch up when you’re ready." />
        <View className="opacity-60">
          <NotificationCard when="Yesterday" text="You have a few new things waiting. Catch up when you’re ready." />
        </View>
      </View>
      <View className="h-px w-72 bg-border dark:bg-border-dark" />
    </View>
  );
}

function NotificationCard({ when, text }: { when: string; text: string }) {
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
        <Text className="text-[13px] text-ink dark:text-ink-dark">{text}</Text>
      </View>
    </View>
  );
}
