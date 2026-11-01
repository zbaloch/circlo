import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { markActivitySeen, refreshActivity, useActivity, type ActivityItem } from '@/lib/activity';
import { listSignIns, type SignIn } from '@/lib/security-events';
import { relativeTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';
import { displayName, markRequestsSeen, useConnections } from '@/lib/use-connections';
import { usePalette } from '@/theme/use-palette';

/** Pure: replies, likes and sign-ins in one newest-first list. Exported for tests. */
export function mergeRows(items: ActivityItem[], signIns: SignIn[]): ({ type: 'activity'; item: ActivityItem } | { type: 'signIn'; signIn: SignIn })[] {
  return [
    ...items.map((item) => ({ type: 'activity' as const, item, at: Date.parse(item.createdAt) })),
    ...signIns.map((signIn) => ({ type: 'signIn' as const, signIn, at: Date.parse(signIn.createdAt) })),
  ]
    .sort((a, b) => b.at - a.at)
    .map(({ at: _at, ...row }) => row);
}

/**
 * Notifications (PLAN.md 2A): friend requests first (they need an answer), then replies and likes on my posts and
 * sign-ins to my account, newest first. There's no remote push: this tab is where activity shows up, and opting in to
 * background checks only adds a count on the lock screen. Opening the tab clears the bell's dot; rows that were new on
 * arrival stay highlighted until you leave.
 */
export default function NotificationsScreen() {
  const { account, connections, error, unseenRequests, refresh } = useConnections();
  const activity = useActivity();
  const palette = usePalette();
  const now = useNow();
  const [signIns, setSignIns] = useState<SignIn[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    await Promise.all([
      refresh(),
      refreshActivity(account).catch(() => {}),
      listSignIns().then(setSignIns, () => {}),
    ]);
  }, [account, refresh]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Remember what was new when the tab opened (or arrived while it's open), then mark it seen (clears the dot).
  const unseenKey = unseenRequests.join(',');
  useFocusEffect(
    useCallback(() => {
      if (!account || !unseenKey) return;
      setFresh((prev) => new Set([...prev, ...unseenKey.split(',')]));
      markRequestsSeen(account);
    }, [account, unseenKey]),
  );
  const newActivity = (activity.items ?? []).slice(0, activity.unseen).map((i) => `${i.kind}:${i.replyId ?? i.actorId}:${i.postId}`);
  const newActivityKey = newActivity.join(',');
  useFocusEffect(
    useCallback(() => {
      if (!account || !newActivityKey) return;
      setFresh((prev) => new Set([...prev, ...newActivityKey.split(',')]));
      markActivitySeen(account);
    }, [account, newActivityKey]),
  );
  useFocusEffect(useCallback(() => () => setFresh(new Set()), []));

  if (!account) return null;
  const incoming = (connections ?? []).filter((c) => c.status === 'incoming');
  const rows = mergeRows(activity.items ?? [], signIns);

  if (connections && activity.items && incoming.length === 0 && rows.length === 0) {
    return (
      <Screen>
        <EmptyState icon="notifications-outline" title="Nothing yet" body="Requests, replies and likes show up here." />
      </Screen>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-surface dark:bg-surface-dark"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <ErrorText>{error}</ErrorText>
      {incoming.map((c) => (
        <Row
          key={c.userId}
          isNew={fresh.has(c.userId)}
          hint="Opens your requests"
          onPress={() => router.navigate({ pathname: '/search', params: { section: 'friends' } })}
          avatar={<Avatar id={c.userId} name={displayName(c)} uri={c.profile.avatarUrl} />}
          title={<><Text className="font-bold text-ink dark:text-ink-dark">{displayName(c)}</Text> wants to connect</>}
          line={`@${c.profile.handle} · Tap to review the request`}
        />
      ))}
      {rows.map((row) => {
        if (row.type === 'signIn') {
          return (
            <Row
              key={`signIn:${row.signIn.id}`}
              isNew={false}
              avatar={
                <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark">
                  <Icon name="shield-checkmark-outline" size={20} color={palette.primary} />
                </View>
              }
              title="New sign-in to your account"
              line={`${relativeTime(Date.parse(row.signIn.createdAt), now)} · If it wasn’t you, change your password in Settings.`}
            />
          );
        }
        const { item } = row;
        const key = `${item.kind}:${item.replyId ?? item.actorId}:${item.postId}`;
        const name = item.actorName;
        const said = item.kind === 'reply' && item.replyText ? item.replyText : item.postText;
        const quote = said ? ` · “${said.length > 60 ? `${said.slice(0, 60)}…` : said}”` : '';
        return (
          <Row
            key={key}
            isNew={fresh.has(key)}
            hint="Opens the post"
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: item.postId } })}
            avatar={<Avatar id={item.actorId} name={name} uri={item.actorAvatar} />}
            title={
              <>
                <Text className="font-bold text-ink dark:text-ink-dark">{name}</Text>
                {item.kind === 'reply' ? ' replied to your post' : ' liked your post'}
              </>
            }
            line={`${relativeTime(Date.parse(item.createdAt), now)}${quote}`}
          />
        );
      })}
    </ScrollView>
  );
}

function Row({ isNew, hint, onPress, avatar, title, line }: {
  isNew: boolean;
  hint?: string;
  onPress?: () => void;
  avatar: React.ReactNode;
  title: React.ReactNode;
  line: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityHint={hint}
      disabled={!onPress}
      onPress={onPress}
      className={`flex-row items-center gap-3 border-b border-border px-5 py-4 active:opacity-60 dark:border-border-dark ${isNew ? 'bg-primary-soft dark:bg-primary-soft-dark' : ''}`}>
      {avatar}
      <View className="flex-1">
        <Text className="text-base text-ink dark:text-ink-dark">{title}</Text>
        <Text numberOfLines={2} className="text-sm text-muted dark:text-muted-dark">
          {line}
        </Text>
      </View>
      {isNew ? <View accessibilityLabel="New" className="h-2.5 w-2.5 rounded-full bg-primary dark:bg-primary-dark" /> : null}
    </Pressable>
  );
}
