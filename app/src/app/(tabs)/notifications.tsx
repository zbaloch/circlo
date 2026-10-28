import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { displayName, markRequestsSeen, useConnections } from '@/lib/use-connections';

/**
 * Notifications (PLAN.md 2A): what happened, not where to act. A friend request is a row that opens the Requests
 * section in Friends, where it can be accepted or declined. Opening this tab clears the bell's dot; rows that were
 * new on arrival stay highlighted until you leave. Replies and likes arrive in later phases.
 */
export default function NotificationsScreen() {
  const { account, connections, error, unseenRequests, refresh } = useConnections();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // Remember what was new when the tab opened (or arrived while it's open), then mark it seen (clears the dot).
  const unseenKey = unseenRequests.join(',');
  useFocusEffect(
    useCallback(() => {
      if (!account || !unseenKey) return;
      setFresh((prev) => new Set([...prev, ...unseenKey.split(',')]));
      markRequestsSeen(account);
    }, [account, unseenKey]),
  );
  useFocusEffect(useCallback(() => () => setFresh(new Set()), []));

  if (!account) return null;
  const incoming = (connections ?? []).filter((c) => c.status === 'incoming');

  if (connections && incoming.length === 0) {
    return (
      <Screen>
        <EmptyState title="Nothing yet" body="Friend requests, replies and likes show up here." />
      </Screen>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-surface dark:bg-surface-dark"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}>
      <ErrorText>{error}</ErrorText>
      {incoming.map((c) => {
        const isNew = fresh.has(c.userId);
        return (
          <Pressable
            key={c.userId}
            accessibilityRole="button"
            accessibilityHint="Opens your friend requests"
            onPress={() => router.navigate({ pathname: '/search', params: { section: 'friends' } })}
            className={`flex-row items-center gap-3 border-b border-border px-5 py-4 active:opacity-60 dark:border-border-dark ${isNew ? 'bg-primary-soft dark:bg-primary-soft-dark' : ''}`}>
            <Avatar name={displayName(c)} />
            <View className="flex-1">
              <Text className="text-base text-ink dark:text-ink-dark">
                <Text className="font-bold text-ink dark:text-ink-dark">{displayName(c)}</Text> wants to be friends
              </Text>
              <Text className="text-sm text-muted dark:text-muted-dark">
                {c.identityChanged ? 'Their security keys changed. Review before accepting.' : 'Tap to review the request'}
              </Text>
            </View>
            {isNew ? <View accessibilityLabel="New" className="h-2.5 w-2.5 rounded-full bg-primary dark:bg-primary-dark" /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
