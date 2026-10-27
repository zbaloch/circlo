import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { MediaGrid } from '@/components/encrypted-media';
import { authorName } from '@/components/post-actions';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { openViewer } from '@/lib/feed-store';
import { discardPicked, discardPrepared, encryptAndUpload, MAX_IMAGES, prepare, type PickedMedia } from '@/lib/media';
import { markRead, removePerson, sendMessage, syncMessaging, useConversations, type ChatMessage } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { chatTitle, dayLabel } from '@/lib/view-logic';
import { usePalette } from '@/theme/use-palette';
import { Text, TextInput } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { Spinner } from '@/components/ui/spinner';

type Row = { kind: 'day'; label: string; key: string } | { kind: 'msg'; msg: ChatMessage; key: string; showName: boolean };

/** Chat (PLAN.md 2A): bubbles (mine on the right in the primary colour), date separators, composer. */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const navigation = useNavigation();
  const palette = usePalette();
  const conv = useConversations().find((c) => c.groupId === id);
  const [book, setBook] = useState<AddressBook | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const list = useRef<FlatList<Row>>(null);

  const sync = useCallback(() => {
    if (account) syncMessaging(account).catch(() => {});
  }, [account]);
  useFocusEffect(
    useCallback(() => {
      if (account) loadAddressBook(account).then(setBook, () => {});
      sync();
      const timer = setInterval(sync, 5_000); // while the chat is open
      return () => clearInterval(timer);
    }, [account, sync]),
  );

  const names = account && conv ? conv.members.map((u) => authorName(account, book, u).name) : [];
  const title = chatTitle(names);
  useEffect(() => {
    navigation.setOptions({
      title,
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="People in this chat" onPress={() => setMembers(true)} className="px-4">
          <Ionicons name="people-outline" size={22} color={palette.ink} />
        </Pressable>
      ),
    });
  }, [navigation, title, palette.ink]);
  useEffect(() => {
    if (conv) markRead(conv.groupId);
  }, [conv, conv?.messages.length]);

  if (!account || !conv) {
    return (
      <View className="flex-1 items-center justify-center bg-surface dark:bg-surface-dark">
        <Spinner />
      </View>
    );
  }

  const rows: Row[] = [];
  let lastDay = '';
  let lastSender = '';
  for (const m of conv.messages) {
    if (hidden.has(m.seq)) continue;
    const day = dayLabel(m.createdAtMs);
    if (day !== lastDay) {
      rows.push({ kind: 'day', label: day, key: `d${m.seq}` });
      lastDay = day;
      lastSender = '';
    }
    rows.push({ kind: 'msg', msg: m, key: `m${m.seq}`, showName: !m.mine && conv.members.length > 1 && m.senderUser !== lastSender });
    lastSender = m.senderUser;
  }

  const send = async (picked: PickedMedia[] = []) => {
    const t = text.trim();
    if ((!t && picked.length === 0) || sending) return;
    setSending(true);
    const prepared = [];
    try {
      // Same pipeline as posts: strip metadata, encrypt per file, size-locked upload; keys travel inside MLS.
      for (const m of picked) prepared.push(...(await prepare(m)));
      const uploaded = prepared.length ? await encryptAndUpload(prepared) : [];
      await sendMessage(account, conv.groupId, t, uploaded);
      discardPicked(picked);
      setText('');
      list.current?.scrollToEnd({ animated: true });
    } catch (e) {
      showAlert('Couldn’t send', e instanceof Error ? e.message : 'Check your connection and try again.');
    } finally {
      discardPrepared(prepared);
      setSending(false);
    }
  };

  const attach = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: MAX_IMAGES, exif: false, quality: 1 });
    if (res.canceled) return;
    const picked: PickedMedia[] = res.assets.map((a) => ({
      uri: a.uri,
      type: a.type === 'video' ? 'video' : 'image',
      width: a.width,
      height: a.height,
      durationMs: a.duration ?? undefined,
      mimeType: a.mimeType ?? undefined,
    }));
    const video = picked.find((p) => p.type === 'video');
    await send(video ? [video] : picked.slice(0, MAX_IMAGES));
  };

  const canSend = conv.active && !conv.unverified;

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-surface dark:bg-surface-dark">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {conv.unverified ? (
          <Text className="bg-danger/10 px-4 py-2 text-sm text-danger dark:text-danger-dark">
            Someone’s security keys in this chat don’t match what you verified. Sending is paused until you check their safety number.
          </Text>
        ) : null}
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerClassName="gap-1 px-3 py-3"
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text className="py-10 text-center text-muted dark:text-muted-dark">Say hello. Messages are end-to-end encrypted.</Text>}
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <Text className="py-2 text-center text-xs text-muted dark:text-muted-dark">{item.label}</Text>
            ) : (
              <Pressable
                onLongPress={() =>
                  showAlert('Message', undefined, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete for me', style: 'destructive' as const, onPress: () => setHidden(new Set([...hidden, item.msg.seq])) },
                  ])
                }
                className={`max-w-[80%] ${item.msg.mine ? 'self-end' : 'self-start'}`}>
                {item.showName ? <Text className="px-2 pb-0.5 text-xs text-muted dark:text-muted-dark">{authorName(account, book, item.msg.senderUser).name}</Text> : null}
                {item.msg.media.length ? (
                  <View className="mb-1 w-64">
                    <MediaGrid
                      media={item.msg.media}
                      onPress={(i) => {
                        openViewer(item.msg.media.filter((m) => m.kind === 'full'), i);
                        router.push('/viewer');
                      }}
                    />
                  </View>
                ) : null}
                {item.msg.text ? (
                  <View className={`rounded-2xl px-4 py-2 ${item.msg.mine ? 'rounded-br-md bg-primary dark:bg-primary-dark' : 'rounded-bl-md bg-surface-raised dark:bg-surface-raised-dark'}`}>
                    <Text className={item.msg.mine ? 'text-base text-white' : 'text-base text-ink dark:text-ink-dark'}>{item.msg.text}</Text>
                  </View>
                ) : null}
              </Pressable>
            )
          }
        />
        <View className="flex-row items-end gap-2 border-t border-border px-3 py-2 dark:border-border-dark">
          <Pressable accessibilityRole="button" accessibilityLabel="Attach photos or video" disabled={!canSend || sending} onPress={attach} className={`h-10 w-10 items-center justify-center ${!canSend || sending ? 'opacity-40' : ''}`}>
            <Ionicons name="image-outline" size={24} color={palette.primary} />
          </Pressable>
          <TextInput
            accessibilityLabel="Message"
            editable={canSend}
            multiline
            placeholder={conv.active ? 'Start a message' : 'You’re no longer in this chat'}
            placeholderTextColor={palette.muted}
            value={text}
            onChangeText={setText}
            maxLength={4000}
            className="max-h-28 flex-1 rounded-2xl bg-surface-raised px-4 py-2 text-base text-ink dark:bg-surface-raised-dark dark:text-ink-dark"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!canSend || !text.trim() || sending}
            onPress={() => send()}
            className={`h-10 w-10 items-center justify-center rounded-full bg-primary dark:bg-primary-dark ${!canSend || !text.trim() || sending ? 'opacity-50' : ''}`}>
            {sending ? <Spinner tone="onPrimary" /> : <Ionicons name="arrow-up" size={20} color="#FFFFFF" />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={members} transparent animationType="slide" onRequestClose={() => setMembers(false)}>
        <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={() => setMembers(false)} />
        <View className="max-h-[70%] gap-1 rounded-t-3xl bg-surface pb-8 pt-4 dark:bg-surface-dark">
          <Text className="px-5 pb-2 text-xl font-bold text-ink dark:text-ink-dark">People</Text>
          {[account.userId, ...conv.members].map((u) => (
            <View key={u} className="flex-row items-center gap-3 px-5 py-2">
              <Avatar size="sm" name={authorName(account, book, u).name} />
              <Text className="flex-1 text-base text-ink dark:text-ink-dark">{u === account.userId ? 'You' : authorName(account, book, u).name}</Text>
              {u !== account.userId && conv.active ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    showAlert('Remove from chat?', 'They won’t be able to read anything sent after this.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => removePerson(account, conv.groupId, u).catch((e) => showAlert('Couldn’t remove', String(e))) },
                    ])
                  }>
                  <Text className="font-semibold text-danger dark:text-danger-dark">Remove</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {conv.active ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMembers(false);
                router.push({ pathname: '/new-message', params: { group: conv.groupId, exclude: conv.members.join(',') } });
              }}
              className="mx-5 mt-3 items-center rounded-full border border-primary py-3 dark:border-primary-dark">
              <Text className="font-bold text-primary dark:text-primary-dark">Add people</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
