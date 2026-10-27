import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { describeError } from '@/lib/account';
import { acceptRequest, declineRequest, InviteError } from '@/lib/friends';
import { displayName, useConnections } from '@/lib/use-connections';
import { Text } from '@/components/ui/text';

/** Friend requests with inline Accept / Decline (PLAN.md 2A). Replies and likes arrive in later phases. */
export default function NotificationsScreen() {
  const { account, connections, error, refresh } = useConnections();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  if (!account) return null;
  const incoming = (connections ?? []).filter((c) => c.status === 'incoming');
  const outgoing = (connections ?? []).filter((c) => c.status === 'outgoing');

  const act = async (userId: string, fn: () => Promise<void>) => {
    setBusy(userId);
    setActionError(undefined);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setActionError(e instanceof InviteError ? e.message : describeError(e));
    } finally {
      setBusy(null);
    }
  };

  if (connections && incoming.length === 0 && outgoing.length === 0) {
    return (
      <Screen>
        <EmptyState title="Nothing yet" body="Friend requests, replies and likes show up here." />
      </Screen>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-surface dark:bg-surface-dark"
      contentContainerClassName="gap-4 p-5"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}>
      <ErrorText>{error ?? actionError}</ErrorText>
      {incoming.map((c) => (
        <View key={c.userId} className="gap-3 rounded-2xl border border-border p-4 dark:border-border-dark">
          <View className="flex-row items-center gap-3">
            <Avatar name={displayName(c)} />
            <View className="flex-1">
              <Text className="font-bold text-ink dark:text-ink-dark">{displayName(c)}</Text>
              <Text className="text-muted dark:text-muted-dark">
                {c.profile?.handle ? `@${c.profile.handle} · ` : ''}wants to be friends
              </Text>
            </View>
          </View>
          {c.identityChanged ? (
            <Text className="text-danger dark:text-danger-dark">Their security keys changed since you last saw them.</Text>
          ) : null}
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button label="Accept" loading={busy === c.userId} onPress={() => act(c.userId, () => acceptRequest(account, c.userId))} />
            </View>
            <View className="flex-1">
              <Button label="Decline" variant="outline" disabled={busy === c.userId} onPress={() => act(c.userId, () => declineRequest(c.userId))} />
            </View>
          </View>
        </View>
      ))}
      {outgoing.length > 0 ? <Text className="pt-2 font-bold text-muted dark:text-muted-dark">Waiting for them to accept</Text> : null}
      {outgoing.map((c) => (
        <Text key={c.userId} className="text-muted dark:text-muted-dark">
          Request sent {c.profile ? `to ${displayName(c)}` : ''}
        </Text>
      ))}
    </ScrollView>
  );
}
