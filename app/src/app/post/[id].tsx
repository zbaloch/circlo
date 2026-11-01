import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { openProfile, usePostActions } from '@/components/post-actions';
import { PostDetail } from '@/components/post-card';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { putPost, usePost } from '@/lib/feed-store';
import { fetchPost } from '@/lib/posts';
import { useSession } from '@/lib/session';
import { deleteReply, fetchLikers, fetchReplies, type Liker, type Reply } from '@/lib/thread';
import { relativeTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';
import { likersLine } from '@/lib/view-logic';
import { Text } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { Spinner } from '@/components/ui/spinner';

/**
 * Thread view, X style (PLAN.md 2A): the post in detail (author row, full-width text and media, full time, actions),
 * and its replies in order. Replying starts from the post's reply button (owner decision 2026-10-31: no docked reply bar).
 */
export default function ThreadScreen() {
  const now = useNow();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const post = usePost(id);
  const [book, setBook] = useState<AddressBook | null>(null);
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [likers, setLikers] = useState<Liker[]>([]);
  const [missing, setMissing] = useState(false);
  const actions = usePostActions(account, book, { inThread: true });

  // Opened from a notification or a link: the post may not be in the timeline yet.
  useEffect(() => {
    if (account && !post) fetchPost(account, id).then(putPost, () => setMissing(true));
  }, [account, post, id]);

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
    if (!missing) return <Spinner className="py-10" />;
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark">
        <EmptyState icon="eye-off-outline" title="Post not available" body="It may have been deleted, or it isn’t shared with you." />
      </View>
    );
  }

  // Keep my own entry in sync with the like button (the list is fetched once per visit).
  const others = likers.filter((l) => l.userId !== account.userId);
  const line = likersLine([...(post.likedByMe ? ['you'] : []), ...others.map((l) => l.name)], 0);

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
            const name = item.authorName;
            const known = item.mine || !!book?.contacts[item.authorId];
            return (
              <Pressable
                onLongPress={item.mine || post.mine ? () => removeReply(item) : undefined}
                className="flex-row gap-3 border-b border-border px-4 py-3 dark:border-border-dark">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${name}'s profile`}
                  disabled={!known}
                  onPress={() => openProfile(account, item.authorId)}
                  className="self-start active:opacity-70">
                  <Avatar size="sm" name={name} uri={item.authorAvatar} />
                </Pressable>
                <View className="flex-1 gap-1">
                  <Text className="text-sm text-muted dark:text-muted-dark">
                    <Text className="font-bold text-ink dark:text-ink-dark">{name}</Text> @{item.authorHandle} · {relativeTime(item.createdAtMs, now)}
                  </Text>
                  <Text className="text-base text-ink dark:text-ink-dark">{item.text}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      </View>
      {actions.sheet}
    </SafeAreaView>
  );
}
