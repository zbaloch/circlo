import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { authorName } from '@/components/post-actions';
import { Screen } from '@/components/screen';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { syncMessaging, unreadCount, useConversations, type Conversation } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/time';
import { chatTitle } from '@/lib/view-logic';
import { Text } from '@/components/ui/text';

/** Messages inbox (PLAN.md 2A): conversations newest first, unread counts kept on this device. */
export default function MessagesScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const conversations = useConversations();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const sync = useCallback(async () => {
    if (!account) return;
    setRefreshing(true);
    try {
      setBook(await loadAddressBook(account));
      await syncMessaging(account);
      setError(undefined);
    } catch {
      setError('Couldn’t check for messages. Pull to try again.');
    } finally {
      setRefreshing(false);
    }
  }, [account]);

  useFocusEffect(
    useCallback(() => {
      sync();
      const timer = setInterval(sync, 30_000);
      return () => clearInterval(timer);
    }, [sync]),
  );

  if (!account) return null;
  const title = (c: Conversation) => chatTitle(c.members.map((u) => authorName(account, book, u).name));

  return (
    <Screen>
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.groupId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={sync} />}
        ListHeaderComponent={error ? <Text className="px-4 py-2 text-center text-sm text-danger dark:text-danger-dark">{error}</Text> : undefined}
        ListEmptyComponent={
          refreshing ? undefined : (
            <View className="h-[520px]">
              <EmptyState title="No messages" body="Messages are end-to-end encrypted. Start a chat with a friend or a group." />
            </View>
          )
        }
        renderItem={({ item }) => {
          const last = item.messages[item.messages.length - 1];
          const unread = unreadCount(item);
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.groupId } })}
              className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
              <Avatar name={title(item)} />
              <View className="flex-1 gap-0.5">
                <View className="flex-row items-center gap-2">
                  <Text numberOfLines={1} className={`flex-1 text-base text-ink dark:text-ink-dark ${unread ? 'font-bold' : 'font-semibold'}`}>
                    {title(item)}
                  </Text>
                  {last ? <Text className="text-sm text-muted dark:text-muted-dark">{relativeTime(last.createdAtMs)}</Text> : null}
                </View>
                <Text numberOfLines={1} className={unread ? 'text-ink dark:text-ink-dark' : 'text-muted dark:text-muted-dark'}>
                  {!item.active ? 'You’re no longer in this chat' : last ? `${last.mine ? 'You: ' : ''}${last.text || 'Photo'}` : 'No messages yet'}
                </Text>
              </View>
              {unread ? (
                <View className="min-w-6 items-center rounded-full bg-primary px-2 py-0.5 dark:bg-primary-dark">
                  <Text className="text-xs font-bold text-on-primary dark:text-on-primary-dark">{unread}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
      <Fab accessibilityLabel="New message" icon="mail-outline" onPress={() => router.push('/new-message')} />
    </Screen>
  );
}
