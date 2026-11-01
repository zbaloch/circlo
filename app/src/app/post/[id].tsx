import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { openProfile, usePostActions } from '@/components/post-actions';
import { Icon } from '@/components/ui/icon';
import { PostDetail } from '@/components/post-card';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { putPost, usePost } from '@/lib/feed-store';
import { fetchPost } from '@/lib/posts';
import { useSession } from '@/lib/session';
import { blockUser } from '@/lib/blocks';
import { deleteReply, fetchLikers, fetchReplies, setReplyLiked, toggledReplyLike, type Liker, type Reply } from '@/lib/thread';
import { relativeTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';
import { likersLine } from '@/lib/view-logic';
import { Text } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { Spinner } from '@/components/ui/spinner';
import { onLiveChange } from '@/lib/live';
import { usePalette } from '@/theme/use-palette';

/**
 * Thread view, X style (PLAN.md 2A): the post in detail (author row, full-width text and media, full time, actions),
 * and its replies in order. Replying starts from the post's reply button (owner decision 2026-10-31: no docked reply bar).
 * Opened from a reply notification (`reply` param), it scrolls to that reply and highlights it. Every reply has a
 * like button and a visible "…" menu (delete, report, block); long-press opens the same menu.
 */
export default function ThreadScreen() {
  const now = useNow();
  const { id, reply: focusReply } = useLocalSearchParams<{ id: string; reply?: string }>();
  const list = useRef<FlatList<Reply>>(null);
  const scrolledTo = useRef<string | null>(null);
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const post = usePost(id);
  const [book, setBook] = useState<AddressBook | null>(null);
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [likers, setLikers] = useState<Liker[]>([]);
  const [missing, setMissing] = useState(false);
  const actions = usePostActions(account, book, { inThread: true });
  const palette = usePalette();

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
  // New replies and likes show up while the thread is open.
  useFocusEffect(useCallback(() => onLiveChange(load), [load]));

  // Once the replies are in, bring the one from the notification into view (once per notification).
  useEffect(() => {
    if (!focusReply || !replies || scrolledTo.current === focusReply) return;
    const index = replies.findIndex((r) => r.replyId === focusReply);
    if (index < 0) return;
    scrolledTo.current = focusReply;
    requestAnimationFrame(() => list.current?.scrollToIndex({ index, viewPosition: 0.3 }));
  }, [focusReply, replies]);

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
          }, () => showAlert('Couldn’t delete', 'Check your connection and try again.')),
      },
    ]);

  const replace = (r: Reply) => setReplies((prev) => (prev ?? []).map((x) => (x.replyId === r.replyId ? r : x)));
  const likeReply = (r: Reply) => {
    const next = toggledReplyLike(r);
    replace(next);
    setReplyLiked(post, r.replyId, next.likedByMe).catch(() => replace(r));
  };

  // What I may do with a reply: delete my own or any on my post; report or block someone else.
  const replyMenu = (r: Reply) => {
    const name = r.authorName;
    const options = [
      ...(r.mine || post.mine ? [{ text: 'Delete reply', style: 'destructive' as const, onPress: () => removeReply(r) }] : []),
      ...(!r.mine
        ? [
            { text: 'Report reply', style: 'destructive' as const, onPress: () => router.push({ pathname: '/report/[id]', params: { id: r.replyId, kind: 'reply', author: r.authorId, name } }) },
            {
              text: `Block ${name}`,
              style: 'destructive' as const,
              onPress: () =>
                blockUser(account, r.authorId, name, r.authorHandle).then(
                  () => setReplies((prev) => (prev ?? []).filter((x) => x.authorId !== r.authorId)),
                  () => showAlert('Couldn’t block', 'Check your connection and try again.'),
                ),
            },
          ]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ];
    showAlert(r.mine ? 'Your reply' : `Reply from ${name}`, undefined, options);
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="flex-1">
        <FlatList
          ref={list}
          data={replies ?? []}
          // Rows aren't measured until rendered: jump near the reply, then try again once it has a size.
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            list.current?.scrollToOffset({ offset: index * averageItemLength });
            setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.3 }), 100);
          }}
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
                onLongPress={() => replyMenu(item)}
                className={`flex-row gap-3 border-b border-border px-4 py-3 dark:border-border-dark ${item.replyId === focusReply ? 'bg-primary-soft dark:bg-primary-soft-dark' : ''}`}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${name}'s profile`}
                  disabled={!known}
                  onPress={() => openProfile(account, item.authorId)}
                  className="self-start active:opacity-70">
                  <Avatar size="sm" id={item.authorId} name={name} uri={item.authorAvatar} />
                </Pressable>
                <View className="flex-1 gap-1">
                  <View className="flex-row items-start gap-2">
                    <Text numberOfLines={1} className="flex-1 text-sm text-muted dark:text-muted-dark">
                      <Text className="font-bold text-ink dark:text-ink-dark">{name}</Text> @{item.authorHandle} · {relativeTime(item.createdAtMs, now)}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Reply options" hitSlop={10} onPress={() => replyMenu(item)} className="-mt-0.5 active:opacity-60">
                      <Icon name="ellipsis-horizontal" size={18} color={palette.muted} />
                    </Pressable>
                  </View>
                  <Text className="text-base text-ink dark:text-ink-dark">{item.text}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.likedByMe ? 'Unlike reply' : 'Like reply'}
                    accessibilityState={{ selected: item.likedByMe }}
                    hitSlop={8}
                    onPress={() => likeReply(item)}
                    className="mt-1 flex-row items-center gap-1 self-start active:opacity-60">
                    <Icon name={item.likedByMe ? 'heart' : 'heart-outline'} size={16} color={item.likedByMe ? palette.danger : palette.muted} />
                    {item.likeCount ? (
                      <Text className={`text-sm ${item.likedByMe ? 'text-danger dark:text-danger-dark' : 'text-muted dark:text-muted-dark'}`}>{item.likeCount}</Text>
                    ) : null}
                  </Pressable>
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
