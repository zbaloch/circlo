import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { authorName, openProfile, usePostActions } from '@/components/post-actions';
import { PostDetail } from '@/components/post-card';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { putPost, usePost } from '@/lib/feed-store';
import { useSession } from '@/lib/session';
import { deleteReply, fetchLikers, fetchReplies, type Reply } from '@/lib/thread';
import { relativeTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';
import { likersLine } from '@/lib/view-logic';
import { Text } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { Spinner } from '@/components/ui/spinner';

/**
 * Thread view, X style (PLAN.md 2A): the post in detail (author row, full-width text and media, full time, actions),
 * its replies in order, and a "Post your reply" bar that opens the reply composer.
 */
export default function ThreadScreen() {
  const now = useNow();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const post = usePost(id);
  const [book, setBook] = useState<AddressBook | null>(null);
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [likers, setLikers] = useState<string[]>([]);
  const actions = usePostActions(account, book, { inThread: true });

  const load = useCallback(() => {
    if (!account || !post) return;
    loadAddressBook(account).then(setBook, () => {});
    fetchReplies(account, post).then(
      (r) => {
        setReplies(r);
        if (r.length !== post.replyCount) putPost({ ...post, replyCount: r.length });
      },
      () => setReplies([]),
    );
    fetchLikers(post).then(setLikers, () => setLikers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the post changes identity, not on like toggles
  }, [account, post?.postId]);
  useFocusEffect(load);

  if (!account) return null;
  if (!post) {
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark">
        <EmptyState icon="eye-off-outline" title="Post not available" body="It may have been deleted, or it isn’t shared with you." />
      </View>
    );
  }

  // Keep my own entry in sync with the like button (the list is fetched once per visit).
  const shownLikers = post.likedByMe ? [...new Set([account.userId, ...likers])] : likers.filter((u) => u !== account.userId);
  const known = shownLikers.filter((u) => u === account.userId || book?.contacts[u]);
  const line = likersLine(
    known.map((u) => (u === account.userId ? 'you' : authorName(account, book, u).name)),
    shownLikers.length - known.length,
  );

  const removeReply = (r: Reply) =>
    showAlert('Delete reply?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteReply(post, r.replyId).then(() => {
            setReplies((prev) => (prev ?? []).filter((x) => x.replyId !== r.replyId));
            putPost({ ...post, replyCount: Math.max(0, post.replyCount - 1) });
          }, () => {}),
      },
    ]);

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="flex-1">
        <FlatList
          data={replies ?? []}
          keyExtractor={(r) => r.replyId}
          ListHeaderComponent={
            <>
              <PostDetail post={post} {...actions.cardProps(post)} />
              {line ? <Text className="border-b border-border px-4 py-2 text-sm text-muted dark:border-border-dark dark:text-muted-dark">{line}</Text> : null}
              {replies === null ? <Spinner className="py-6" /> : null}
            </>
          }
          ListEmptyComponent={replies ? <Text className="px-4 py-6 text-center text-muted dark:text-muted-dark">No replies yet.</Text> : undefined}
          renderItem={({ item }) => {
            const who = authorName(account, book, item.authorId);
            const name = item.mine || book?.contacts[item.authorId] ? who.name : 'Someone the author knows';
            return (
              <Pressable
                onLongPress={item.mine || post.mine ? () => removeReply(item) : undefined}
                className="flex-row gap-3 border-b border-border px-4 py-3 dark:border-border-dark">
                <Pressable accessibilityRole="button" accessibilityLabel={`${name}'s profile`} onPress={() => openProfile(account, item.authorId)} className="self-start active:opacity-70">
                  <Avatar size="sm" name={name} />
                </Pressable>
                <View className="flex-1 gap-1">
                  <Text className="text-sm text-muted dark:text-muted-dark">
                    <Text className="font-bold text-ink dark:text-ink-dark">{name}</Text> · {relativeTime(item.createdAtMs, now)}
                  </Text>
                  <Text className="text-base text-ink dark:text-ink-dark">{item.text}</Text>
                </View>
              </Pressable>
            );
          }}
        />
        {/* X style: a bar that opens the reply composer, with the post shown above what I type. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Post your reply"
          onPress={() => router.push({ pathname: '/reply/[id]', params: { id: post.postId } })}
          className="flex-row items-center gap-3 border-t border-border px-4 py-2 dark:border-border-dark">
          <Avatar size="sm" name={authorName(account, book, account.userId).name} />
          <View className="flex-1 rounded-full bg-surface-raised px-4 py-2.5 dark:bg-surface-raised-dark">
            <Text className="text-base text-muted dark:text-muted-dark">Post your reply</Text>
          </View>
        </Pressable>
      </View>
      {actions.sheet}
    </SafeAreaView>
  );
}
