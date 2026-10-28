import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { CharRing } from '@/components/char-ring';
import { EmptyState } from '@/components/empty-state';
import { authorName, usePostActions } from '@/components/post-actions';
import { PostCard } from '@/components/post-card';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { putPost, usePost } from '@/lib/feed-store';
import { useSession } from '@/lib/session';
import { deleteReply, fetchLikers, fetchReplies, MAX_REPLY_CHARS, sendReply, validateReply, type Reply } from '@/lib/thread';
import { relativeTime } from '@/lib/time';
import { likersLine } from '@/lib/view-logic';
import { usePalette } from '@/theme/use-palette';
import { Text, TextInput } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { Spinner } from '@/components/ui/spinner';

/** Thread view (PLAN.md 2A): the post, its replies in order, and a reply composer docked at the bottom. */
export default function ThreadScreen() {
  const { id, reply } = useLocalSearchParams<{ id: string; reply?: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const palette = usePalette();
  const post = usePost(id);
  const [book, setBook] = useState<AddressBook | null>(null);
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [likers, setLikers] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
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
        <EmptyState title="Post not available" body="It may have been deleted, or it isn’t shared with you." />
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

  const send = async () => {
    if (validateReply(text) || sending) return;
    setSending(true);
    try {
      const r = await sendReply(account, post, text);
      setReplies((prev) => [...(prev ?? []), r]);
      putPost({ ...post, replyCount: post.replyCount + 1 });
      setText('');
    } catch {
      showAlert('Couldn’t send reply', 'Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

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
      <KeyboardAvoidingView className="flex-1" behavior="padding" keyboardVerticalOffset={90}>
        <FlatList
          data={replies ?? []}
          keyExtractor={(r) => r.replyId}
          ListHeaderComponent={
            <>
              <PostCard post={post} {...actions.cardProps(post)} />
              {line ? <Text className="border-b border-border px-4 py-2 text-sm text-muted dark:border-border-dark dark:text-muted-dark">{line}</Text> : null}
              {replies === null ? <Spinner className="py-6" /> : null}
            </>
          }
          ListEmptyComponent={replies ? <Text className="px-4 py-6 text-center text-muted dark:text-muted-dark">No replies yet.</Text> : undefined}
          renderItem={({ item }) => {
            const who = authorName(account, book, item.authorId);
            const name = item.mine || book?.contacts[item.authorId] ? who.name : 'A friend of the author';
            return (
              <Pressable
                onLongPress={item.mine || post.mine ? () => removeReply(item) : undefined}
                className="flex-row gap-3 border-b border-border px-4 py-3 dark:border-border-dark">
                <Avatar size="sm" name={name} />
                <View className="flex-1 gap-1">
                  <Text className="text-sm text-muted dark:text-muted-dark">
                    <Text className="font-bold text-ink dark:text-ink-dark">{name}</Text> · {relativeTime(item.createdAtMs)}
                  </Text>
                  <Text className="text-base text-ink dark:text-ink-dark">{item.text}</Text>
                </View>
              </Pressable>
            );
          }}
        />
        <View className="flex-row items-end gap-2 border-t border-border px-3 py-2 dark:border-border-dark">
          <TextInput
            accessibilityLabel="Reply"
            autoFocus={reply === '1'}
            multiline
            placeholder="Post your reply"
            placeholderTextColor={palette.muted}
            value={text}
            onChangeText={setText}
            className="max-h-28 flex-1 rounded-2xl bg-surface-raised px-4 py-2 text-base text-ink dark:bg-surface-raised-dark dark:text-ink-dark"
          />
          {text ? <CharRing used={[...text].length} limit={MAX_REPLY_CHARS} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            disabled={!!validateReply(text) || sending}
            onPress={send}
            className={`h-10 w-10 items-center justify-center rounded-full bg-primary dark:bg-primary-dark ${validateReply(text) || sending ? 'opacity-50' : ''}`}>
            {sending ? <Spinner tone="onPrimary" /> : <Ionicons name="arrow-up" size={20} color={palette.onPrimary} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      {actions.sheet}
    </SafeAreaView>
  );
}
