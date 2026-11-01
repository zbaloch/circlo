import { Icon } from '@/components/ui/icon';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { CharRing } from '@/components/char-ring';
import { MediaImage } from '@/components/post-media';
import { authorName } from '@/components/post-actions';
import { PostText } from '@/components/post-card';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { showAlert } from '@/lib/dialog';
import { putPost, usePost } from '@/lib/feed-store';
import { useSession } from '@/lib/session';
import { MAX_REPLY_CHARS, sendReply, validateReply } from '@/lib/thread';
import { relativeTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';
import { usePalette } from '@/theme/use-palette';
import { Spinner } from '@/components/ui/spinner';
import { Text, TextInput } from '@/components/ui/text';

/**
 * Reply composer, X style: Cancel and Reply on top, the post being answered with a thread line, "Replying to
 * @handle", then my avatar and the text box. Opened from the reply icon on any post or the thread's reply bar.
 */
export default function ReplyScreen() {
  const now = useNow();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const palette = usePalette();
  const post = usePost(id);
  const [book, setBook] = useState<AddressBook | null>(null);
  // Drawer screens stay mounted between visits, so the draft and the sending state belong to one post: a reply to
  // another post starts empty.
  const [draft, setDraft] = useState({ id, text: '' });
  const [sendingId, setSendingId] = useState<string | null>(null);
  const text = draft.id === id ? draft.text : '';
  const setText = (t: string) => setDraft({ id, text: t });
  const sending = sendingId === id;

  useFocusEffect(
    useCallback(() => {
      if (account) loadAddressBook(account).then(setBook, () => {});
    }, [account]),
  );

  if (!account || !post) return null;
  const author = { name: post.authorName, handle: post.authorHandle };
  const me = authorName(account, book, account.userId);
  const blocked = !!validateReply(text) || sending;
  // X shows a small preview of the media on the right: a photo's thumbnail or a video's poster.
  const preview = post.media[0];
  const isVideo = preview?.type === 'video';

  const send = async () => {
    if (blocked) return;
    setSendingId(id);
    try {
      await sendReply(account, post, text);
      putPost({ ...post, replyCount: post.replyCount + 1 });
      setText('');
      setSendingId(null);
      router.back();
    } catch {
      showAlert('Couldn’t send reply', 'Check your connection and try again.');
      setSendingId(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <KeyboardAvoidingView className="flex-1" behavior="padding">
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

        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-2" keyboardShouldPersistTaps="handled">
          {/* The post being answered, joined to my reply by a thread line. */}
          <View className="flex-row gap-3">
            <View className="items-center">
              <Avatar id={post.authorId} name={author.name} />
              <View className="mt-1 w-0.5 flex-1 rounded-full bg-border dark:bg-border-dark" />
            </View>
            <View className="flex-1 flex-row gap-3 pb-4">
            <View className="flex-1 gap-1">
              <View className="flex-row items-center gap-1">
                <Text numberOfLines={1} className="shrink text-[15px] font-bold text-ink dark:text-ink-dark">{author.name}</Text>
                {author.handle ? <Text numberOfLines={1} className="shrink text-[15px] text-muted dark:text-muted-dark">@{author.handle}</Text> : null}
                <Text className="text-[15px] text-muted dark:text-muted-dark">· {relativeTime(post.createdAtMs, now)}</Text>
              </View>
              {post.text ? <PostText text={post.text} className="text-[15px] leading-5 text-ink dark:text-ink-dark" /> : null}
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
            <Avatar id={account.userId} name={me.name} />
            <TextInput
              accessibilityLabel="Reply"
              autoFocus
              multiline
              placeholder="Post your reply"
              placeholderTextColor={palette.muted}
              value={text}
              onChangeText={setText}
              className="flex-1 pt-2 text-lg text-ink dark:text-ink-dark"
            />
          </View>
        </ScrollView>

        <View className="flex-row items-center justify-end border-t border-border px-4 py-2 dark:border-border-dark">
          <CharRing used={[...text].length} limit={MAX_REPLY_CHARS} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
