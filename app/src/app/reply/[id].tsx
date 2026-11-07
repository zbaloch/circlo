import { Icon } from '@/components/ui/icon';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { CharRing } from '@/components/char-ring';
import { MediaImage } from '@/components/post-media';
import { authorName } from '@/components/post-actions';
import { PostText } from '@/components/post-card';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { showAlert } from '@/lib/dialog';
import { putPost, usePost } from '@/lib/feed-store';
import { useMe } from '@/lib/me';
import { useSession } from '@/lib/session';
import { MAX_REPLY_CHARS, noteSentReply, replyTarget, sendReply, validateReply } from '@/lib/thread';
import { relativeTime } from '@/lib/time';
import { showToast } from '@/lib/toast';
import { useNow } from '@/lib/use-now';
import { usePalette } from '@/theme/use-palette';
import { Spinner } from '@/components/ui/spinner';
import { useFollowCaret } from '@/components/follow-caret';
import { Text, TextInput } from '@/components/ui/text';

/**
 * Reply composer, X style: Cancel and Reply on top, the post being answered with a thread line, "Replying to
 * @handle", then my avatar and the text box. Opened from the reply icon on any post, or on a reply in a thread
 * (`parent`): then that reply is shown and answered, and the server keeps the answer in that reply's circle. After
 * sending it goes back: to the thread with the new reply highlighted, or elsewhere (the timeline, a profile) with a
 * "Reply sent · View" toast.
 */
export default function ReplyScreen() {
  const now = useNow();
  const { id, from, parent } = useLocalSearchParams<{ id: string; from?: string; parent?: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const palette = usePalette();
  const post = usePost(id);
  const myProfile = useMe();
  const [book, setBook] = useState<AddressBook | null>(null);
  // Drawer screens stay mounted between visits, so the draft and the sending state belong to one post: a reply to
  // another post (or another reply) starts empty.
  const key = `${id}:${parent ?? ''}`;
  const [draft, setDraft] = useState({ key, text: '' });
  const [sendingId, setSendingId] = useState<string | null>(null);
  const text = draft.key === key ? draft.text : '';
  const setText = (t: string) => setDraft({ key, text: t });
  const sending = sendingId === key;
  const scroll = useRef<ScrollViewInstance>(null);
  const follow = useFollowCaret(scroll, text);

  useFocusEffect(
    useCallback(() => {
      if (account) loadAddressBook(account).then(setBook, () => {});
    }, [account]),
  );

  if (!account || !post) return null;
  // What's being answered: the reply opened from, or the post.
  const answering = replyTarget(parent);
  const shown = answering
    ? { authorId: answering.authorId, name: answering.authorName, handle: answering.authorHandle, avatar: answering.authorAvatar, at: answering.createdAtMs, text: answering.text }
    : { authorId: post.authorId, name: post.authorName, handle: post.authorHandle, avatar: undefined, at: post.createdAtMs, text: post.text };
  const author = { name: shown.name, handle: shown.handle };
  const me = authorName(account, book, account.userId);
  const blocked = !!validateReply(text) || sending;
  // X shows a small preview of the media on the right: a photo's thumbnail or a video's poster.
  const preview = answering ? undefined : post.media[0];
  const isVideo = preview?.type === 'video';

  const send = async () => {
    if (blocked) return;
    setSendingId(key);
    try {
      const reply = await sendReply(account, post, text, parent);
      putPost({ ...post, replyCount: post.replyCount + 1 });
      setText('');
      setSendingId(null);
      router.back();
      // X style: back on the thread the new reply is highlighted; anywhere else a toast offers to open it.
      if (from === 'thread') noteSentReply(post.postId, reply);
      else showToast('Reply sent', { text: 'View', onPress: () => router.push({ pathname: '/post/[id]', params: { id: post.postId, reply: reply.replyId } }) });
    } catch {
      showAlert('Couldn’t send reply', 'Check your connection and try again.');
      setSendingId(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="flex-1">
        <View className="flex-row items-center justify-between px-4 py-2">
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8} className="active:opacity-60">
            <Text className="text-base text-ink dark:text-ink-dark">Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            disabled={blocked}
            onPress={send}
            className={`rounded-full bg-primary px-5 py-2 active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark ${blocked ? 'opacity-50' : ''}`}>
            {sending ? <Spinner tone="onPrimary" /> : <Text className="text-base font-bold text-on-primary dark:text-on-primary-dark">Reply</Text>}
          </Pressable>
        </View>

        <ScrollView ref={scroll} className="flex-1" contentContainerClassName="px-4 pt-2" keyboardShouldPersistTaps="handled">
          {/* The post (or reply) being answered, joined to my reply by a thread line. */}
          <View className="flex-row gap-3">
            <View className="items-center">
              <Avatar id={shown.authorId} name={author.name} uri={shown.avatar} />
              <View className="mt-1 w-0.5 flex-1 rounded-full bg-border dark:bg-border-dark" />
            </View>
            <View className="flex-1 flex-row gap-3 pb-4">
            <View className="flex-1 gap-1">
              <View className="flex-row items-center gap-1">
                <Text numberOfLines={1} className="shrink text-[15px] font-bold text-ink dark:text-ink-dark">{author.name}</Text>
                {author.handle ? <Text numberOfLines={1} className="shrink text-[15px] text-muted dark:text-muted-dark">@{author.handle}</Text> : null}
                <Text className="text-[15px] text-muted dark:text-muted-dark">· {relativeTime(shown.at, now)}</Text>
              </View>
              {answering ? <Text className="text-[15px] leading-5 text-ink dark:text-ink-dark">{answering.text}</Text> : null}
              {!answering && post.text ? <PostText text={post.text} className="text-[15px] leading-5 text-ink dark:text-ink-dark" /> : null}
              <Text className="pt-3 text-[15px] text-muted dark:text-muted-dark">
                Replying to <Text className="text-primary dark:text-primary-dark">{author.handle ? `@${author.handle}` : author.name}</Text>
              </Text>
            </View>
            {preview ? (
              <View className="h-20 w-20 overflow-hidden rounded-xl">
                <MediaImage objectKey={preview.previewKey} url={preview.previewUrl} className="h-full w-full" />
                {isVideo ? (
                  <View className="absolute inset-0 items-center justify-center">
                    <View className="h-8 w-8 items-center justify-center rounded-full bg-black/50">
                      <Icon name="play" size={16} color="#FFFFFF" />
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
            </View>
          </View>

          {/* My reply. */}
          <View className="flex-row gap-3">
            <Avatar id={account.userId} name={me.name} uri={myProfile?.avatarUrl} />
            <TextInput
              accessibilityLabel="Reply"
              autoFocus
              multiline
              placeholder="Post your reply"
              placeholderTextColor={palette.muted}
              value={text}
              onChangeText={setText}
              {...follow}
              className="flex-1 pt-2 text-lg text-ink dark:text-ink-dark"
            />
          </View>
        </ScrollView>

        <View className="flex-row items-center justify-end border-t border-border px-4 py-2 dark:border-border-dark">
          <CharRing used={[...text].length} limit={MAX_REPLY_CHARS} />
        </View>
      </View>
      <KeyboardSpacer />
    </SafeAreaView>
  );
}
