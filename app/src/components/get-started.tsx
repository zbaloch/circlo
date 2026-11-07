import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { Connection } from '@/lib/friends';
import { usePalette } from '@/theme/use-palette';

export type Step = { key: 'invite' | 'post'; title: string; body: string; done: boolean; actionLabel: string; open: () => void };

/**
 * Pure: the two steps on an empty Home. Inviting covers circles too (they're chosen when someone joins), and ticks
 * itself once someone is connected; a waiting request is the quickest way in. Exported for tests.
 */
export function getStartedSteps(connections: Connection[] | null): Step[] {
  const all = connections ?? [];
  const friends = all.filter((c) => c.status === 'accepted').length;
  const requests = all.filter((c) => c.status === 'incoming').length;
  const invite: Step =
    friends > 0
      ? { key: 'invite', title: 'Invite someone', body: `You’re connected with ${friends} ${friends === 1 ? 'person' : 'people'}. Invite more whenever you like.`, done: true, actionLabel: 'Invite', open: () => router.push({ pathname: '/add-people', params: { section: 'invite' } }) }
      : requests > 0
        ? { key: 'invite', title: 'Invite someone', body: 'Someone wants to connect. Accept, and choose which of your circles they’re in.', done: false, actionLabel: 'Review request', open: () => router.navigate({ pathname: '/search', params: { section: 'friends' } }) }
        : { key: 'invite', title: 'Invite someone', body: 'Share your invite link or QR code. When they join, you choose which of your circles they’re in.', done: false, actionLabel: 'Invite', open: () => router.push({ pathname: '/add-people', params: { section: 'invite' } }) };
  return [
    invite,
    { key: 'post', title: 'Write your first post', body: 'Choose who sees it: Everyone, or just the circles you pick.', done: false, actionLabel: 'Write', open: () => router.push('/compose') },
  ];
}

/** The "Get started" card on an empty Home: it goes away by itself once there are posts. */
export function GetStarted({ connections }: { connections: Connection[] | null }) {
  const palette = usePalette();
  const steps = getStartedSteps(connections);
  return (
    <View className="mx-4 my-6 gap-4 rounded-2xl border border-border p-5 dark:border-border-dark">
      <View className="gap-1">
        <Text accessibilityRole="header" className="text-2xl font-extrabold text-ink dark:text-ink-dark">Get started</Text>
        <Text className="text-base text-muted dark:text-muted-dark">Two steps and Circlo is yours. Posts from your people show up here.</Text>
      </View>
      {steps.map((s, i) => (
        <View key={s.key} className="flex-row gap-3">
          <View className={`h-8 w-8 items-center justify-center rounded-full ${s.done ? 'bg-primary dark:bg-primary-dark' : 'bg-primary-soft dark:bg-primary-soft-dark'}`}>
            {s.done ? <Icon name="checkmark" size={18} color={palette.onPrimary} /> : <Text className="font-bold text-primary dark:text-primary-dark">{i + 1}</Text>}
          </View>
          <View className="flex-1 gap-1">
            <Text className={`text-base font-bold ${s.done ? 'text-muted line-through dark:text-muted-dark' : 'text-ink dark:text-ink-dark'}`}>{s.title}</Text>
            <Text className="text-[15px] leading-5 text-muted dark:text-muted-dark">{s.body}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.actionLabel}
            accessibilityHint={s.title}
            onPress={s.open}
            hitSlop={6}
            className={`min-h-[32px] items-center justify-center self-start rounded-full px-4 active:opacity-60 ${
              s.done ? 'border border-border dark:border-border-dark' : 'bg-primary dark:bg-primary-dark'
            }`}>
            <Text className={`text-sm font-bold ${s.done ? 'text-ink dark:text-ink-dark' : 'text-on-primary dark:text-on-primary-dark'}`}>{s.actionLabel}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
