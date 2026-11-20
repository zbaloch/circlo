import { ContentText } from '@/components/content-text';
import { textDirection, usesSystemFont } from '@/lib/script';
import { Icon } from '@/components/ui/icon';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';

import { CHAT_ENABLED } from '@/lib/features';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, View, type TextInputInstance } from 'react-native';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ChatTitle } from '@/components/chat-title';
import { openProfile } from '@/components/post-actions';
import { MediaGrid } from '@/components/post-media';
import { SwipeToReply } from '@/components/swipe-to-reply';
import { blockUser, refreshBlocked, useBlocked, visibleMessages } from '@/lib/blocks';
import { openViewer } from '@/lib/feed-store';
import { useMe } from '@/lib/me';
import { discardPicked, discardPrepared, MAX_IMAGES, prepare, upload, type PickedMedia, type PreparedItem } from '@/lib/media';
import {
  deleteMessage,
  markRead,
  memberName,
  quoteLines,
  quoteOf,
  removePerson,
  sendMessage,
  syncMessaging,
  useConversations,
  type ChatMessage,
  type ChatQuote,
} from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { chatTitle, clockTime, dayLabel, endsRun } from '@/lib/view-logic';
import { onLiveChange } from '@/lib/live';
import { usePalette } from '@/theme/use-palette';
import { Text, TextInput } from '@/components/ui/text';
import { DialogHost } from '@/components/ui/dialog-host';
import { dialogOpen, dismissDialog, showAlert } from '@/lib/dialog';
import { Spinner } from '@/components/ui/spinner';

type Row = { kind: 'day'; label: string; key: string } | { kind: 'msg'; msg: ChatMessage; key: string; showName: boolean; showTime: boolean };

/** Chat (PLAN.md 2A): bubbles (mine on the right in the primary colour), date separators, replies to one message, composer. */
/** Chat is hidden for now (lib/features): a direct link lands on Home. */
export default function ChatScreenRoute() {
  return CHAT_ENABLED ? <ChatScreen /> : <Redirect href="/" />;
}

export function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const navigation = useNavigation();
  const palette = usePalette();
  const conv = useConversations().find((c) => c.groupId === id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  // The message the next one replies to, and the one briefly highlighted after tapping a quote.
  const [replying, setReplying] = useState<ChatMessage | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const input = useRef<TextInputInstance>(null);
  const me = useMe();
  const blocked = useBlocked();
  const list = useRef<FlatList<Row>>(null);

  const sync = useCallback(() => {
    if (account) syncMessaging(account, id).catch(() => {});
  }, [account, id]);
  useFocusEffect(
    useCallback(() => {
      refreshBlocked().catch(() => {});
      sync();
      // New messages arrive the moment the server signals them; the timer is only a fallback.
      const off = onLiveChange(sync);
      const timer = setInterval(sync, 15_000);
      return () => {
        off();
        clearInterval(timer);
      };
    }, [sync]),
  );

  const names = account && conv ? conv.members.map((u) => memberName(conv, u, account)) : [];
  const title = conv?.name || chatTitle(names);
  useEffect(() => {
    navigation.setOptions({
      title,
      // Their photo and name; tapping opens their profile (or, in a group, who's in it).
      headerTitle: account && conv ? () => <ChatTitle conv={conv} account={account} onGroup={() => setMembers(true)} /> : undefined,
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="People in this chat" onPress={() => setMembers(true)} className="px-4">
          <Icon name="people-outline" size={22} color={palette.ink} />
        </Pressable>
      ),
    });
  }, [navigation, title, palette.ink, account, conv]);
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
  const shown = visibleMessages(conv.messages, blocked).filter((m) => !hidden.has(m.seq));
  for (const [i, m] of shown.entries()) {
    const day = dayLabel(m.createdAtMs);
    if (day !== lastDay) {
      rows.push({ kind: 'day', label: day, key: `d${m.seq}` });
      lastDay = day;
      lastSender = '';
    }
    rows.push({ kind: 'msg', msg: m, key: `m${m.seq}`, showName: !m.mine && conv.members.length > 1 && m.senderUser !== lastSender, showTime: endsRun(m, shown[i + 1]) });
    lastSender = m.senderUser;
  }
  // A reply to a message that has since been deleted or hidden is dropped.
  const replyingTo = replying && shown.some((m) => m.seq === replying.seq) ? replying : null;
  const nameOf = (userId: string) => memberName(conv, userId, account);

  const reply = (msg: ChatMessage) => {
    setReplying(msg);
    input.current?.focus();
  };

  // Tapping a quote scrolls to the message it quotes, when it's loaded, and highlights it for a moment.
  const jump = (quote: ChatQuote) => {
    const index = rows.findIndex((r) => r.kind === 'msg' && r.msg.messageId === quote.messageId);
    if (!quote.available || index < 0) return;
    list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setFlash(quote.messageId);
    setTimeout(() => setFlash((f) => (f === quote.messageId ? null : f)), 1500);
  };

  const send = async (picked: PickedMedia[] = []) => {
    const t = text.trim();
    if ((!t && picked.length === 0) || sending) return;
    setSending(true);
    const prepared: PreparedItem[] = [];
    try {
      // Same pipeline as posts: metadata removed, then a size-locked upload.
      for (const m of picked) prepared.push(await prepare(m));
      const uploaded = await upload(prepared);
      await sendMessage(account, conv.groupId, t, uploaded, replyingTo?.messageId);
      discardPicked(picked);
      setText('');
      setReplying(null);
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

  const canSend = conv.active;

  // Long press: delete my own message for everyone, or hide someone else's here; report it or block them.
  const messageMenu = (msg: ChatMessage) => {
    const name = memberName(conv, msg.senderUser, account);
    const person = conv.people[msg.senderUser];
    const block = () =>
      showAlert(`Block ${name}?`, 'You’ll stop being connected. They can’t send you requests or see anything new you post, and their messages are hidden. They aren’t told.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: () => blockUser(account, msg.senderUser, person?.name, person?.handle).catch(() => showAlert('Couldn’t block', 'Check your connection and try again.')) },
      ]);
    showAlert('Message', undefined, [
      ...(canSend ? [{ text: 'Reply', onPress: () => reply(msg) }] : []),
      msg.mine
        ? { text: 'Delete for everyone', style: 'destructive', onPress: () => deleteMessage(conv.groupId, msg).catch(() => showAlert('Couldn’t delete', 'Check your connection and try again.')) }
        : { text: 'Hide here', style: 'destructive', onPress: () => setHidden(new Set([...hidden, msg.seq])) },
      ...(!msg.mine
        ? [{ text: 'Report message', style: 'destructive' as const, onPress: () => router.push({ pathname: '/report/[id]', params: { id: msg.messageId, kind: 'message', chat: conv.groupId } }) }]
        : []),
      ...(!msg.mine ? [{ text: `Block ${name}`, style: 'destructive' as const, onPress: block }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-surface dark:bg-surface-dark">
      <View className="flex-1">
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerClassName="gap-1 px-3 py-3"
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          // The list shrinks while the keyboard opens: keep the newest message in view.
          onLayout={() => list.current?.scrollToEnd({ animated: false })}
          // Rows far off screen haven't been measured yet: get near the message first, then scroll to it.
          onScrollToIndexFailed={(info) => {
            list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }), 100);
          }}
          ListEmptyComponent={<Text className="py-10 text-center text-muted dark:text-muted-dark">Say hello. Only the people in this chat can see it.</Text>}
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <Text className="py-2 text-center text-xs text-muted dark:text-muted-dark">{item.label}</Text>
            ) : (
              // A visible "…" beside each bubble (on the inner side) opens the same menu as a long-press; on phones a
              // swipe to the right replies too.
              <SwipeToReply enabled={canSend} onReply={() => reply(item.msg)} color={palette.muted}>
                <View
                  className={`max-w-[85%] flex-row items-center gap-1 rounded-2xl ${item.msg.mine ? 'self-end' : 'self-start'} ${flash === item.msg.messageId ? 'bg-primary-soft dark:bg-primary-soft-dark' : ''}`}>
                  {item.msg.mine ? <MessageMenuButton onPress={() => messageMenu(item.msg)} color={palette.muted} /> : null}
                  {!item.msg.mine ? (
                    // Their photo beside the last message of each run (X style), opening their profile; a gap of the
                    // same width beside the others keeps their bubbles in line.
                    item.showTime ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${nameOf(item.msg.senderUser)}’s profile`}
                        onPress={() => openProfile(account, item.msg.senderUser)}
                        className="mb-[18px] self-end active:opacity-70">
                        <Avatar size="sm" id={item.msg.senderUser} name={nameOf(item.msg.senderUser)} uri={conv.people[item.msg.senderUser]?.avatarUrl} />
                      </Pressable>
                    ) : (
                      <View className="w-8" />
                    )
                  ) : null}
                  <Pressable
                    onLongPress={() => messageMenu(item.msg)}
                    className="shrink">
                    {item.showName ? <Text className="px-2 pb-0.5 text-xs text-muted dark:text-muted-dark">{memberName(conv, item.msg.senderUser, account)}</Text> : null}
                    {item.msg.replyTo ? <Quote quote={item.msg.replyTo} nameOf={nameOf} mine={item.msg.mine} onPress={() => jump(item.msg.replyTo!)} /> : null}
                    {item.msg.media.length ? (
                      <View className="mb-1 w-64">
                        <MediaGrid
                          media={item.msg.media}
                          onPress={(i) => {
                            openViewer(item.msg.media.filter((m) => m.type === 'image'), i);
                            router.push('/viewer');
                          }}
                        />
                      </View>
                    ) : null}
                    {item.msg.text ? (
                      <View className={`rounded-2xl px-4 py-2 ${item.msg.mine ? 'rounded-br-md bg-primary dark:bg-primary-dark' : 'rounded-bl-md bg-surface-raised dark:bg-surface-raised-dark'}`}>
                        <ContentText text={item.msg.text} className={item.msg.mine ? 'text-base text-on-primary dark:text-on-primary-dark' : 'text-base text-ink dark:text-ink-dark'} />
                      </View>
                    ) : null}
                    {item.showTime ? (
                      <Text className={`px-2 pt-0.5 text-xs text-muted dark:text-muted-dark ${item.msg.mine ? 'text-right' : ''}`}>{clockTime(item.msg.createdAtMs)}</Text>
                    ) : null}
                  </Pressable>
                  {!item.msg.mine ? <MessageMenuButton onPress={() => messageMenu(item.msg)} color={palette.muted} /> : null}
                </View>
              </SwipeToReply>
            )
          }
        />
        {replyingTo ? (
          <ReplyingBar quote={quoteOf(replyingTo)} nameOf={(u) => (u === account.userId ? 'yourself' : nameOf(u))} onCancel={() => setReplying(null)} color={palette.muted} />
        ) : null}
        <View className="flex-row items-end gap-2 border-t border-border px-3 py-2 dark:border-border-dark">
          <Pressable accessibilityRole="button" accessibilityLabel="Attach photos or video" disabled={!canSend || sending} onPress={attach} className={`h-10 w-10 items-center justify-center ${!canSend || sending ? 'opacity-40' : ''}`}>
            <Icon name="image-outline" size={24} color={palette.primary} />
          </Pressable>
          <TextInput
            ref={input}
            accessibilityLabel="Message"
            editable={canSend}
            multiline
            placeholder={conv.active ? 'Start a message' : 'You’re no longer in this chat'}
            placeholderTextColor={palette.muted}
            value={text}
            onChangeText={setText}
            maxLength={4000}
            system={usesSystemFont(text)}
            className={`max-h-28 flex-1 rounded-2xl bg-surface-raised px-4 py-2 text-base text-ink dark:bg-surface-raised-dark dark:text-ink-dark ${textDirection(text) === 'rtl' ? 'text-right' : ''}`}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={!canSend || !text.trim() || sending}
            onPress={() => send()}
            className={`h-10 w-10 items-center justify-center rounded-full bg-primary dark:bg-primary-dark ${!canSend || !text.trim() || sending ? 'opacity-50' : ''}`}>
            {sending ? <Spinner tone="onPrimary" /> : <Icon name="arrow-up" size={20} color={palette.onPrimary} />}
          </Pressable>
        </View>
      </View>
      <KeyboardSpacer />

      <Modal visible={members} transparent animationType="slide" onRequestClose={() => (dialogOpen() ? dismissDialog() : setMembers(false))}>
        <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={() => setMembers(false)} />
        <View className="max-h-[70%] gap-1 rounded-t-3xl bg-surface pb-8 pt-4 dark:bg-surface-dark">
          <Text className="px-5 pb-2 text-xl font-bold text-ink dark:text-ink-dark">People</Text>
          {[account.userId, ...conv.members].map((u) => (
            <View key={u} className="flex-row items-center gap-3 px-5 py-2">
              <Avatar size="sm" id={u} name={memberName(conv, u, account, me?.name)} uri={u === account.userId ? me?.avatarUrl : conv.people[u]?.avatarUrl} />
              <Text className="flex-1 text-base text-ink dark:text-ink-dark">{u === account.userId ? 'You' : memberName(conv, u, account)}</Text>
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
          {conv.active ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                showAlert('Leave this chat?', 'You won’t see new messages, and it disappears from your inbox.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Leave',
                    style: 'destructive',
                    onPress: () =>
                      removePerson(account, conv.groupId, account.userId).then(
                        () => {
                          setMembers(false);
                          router.back();
                        },
                        () => showAlert('Couldn’t leave', 'Check your connection and try again.'),
                      ),
                  },
                ])
              }
              className="mx-5 mt-2 items-center py-3">
              <Text className="font-bold text-danger dark:text-danger-dark">Leave chat</Text>
            </Pressable>
          ) : null}
        </View>
        {/* Dialogs opened from this sheet show inside it, not as a second Modal. */}
        <DialogHost inline />
      </Modal>
    </SafeAreaView>
  );
}

/** The quoted message above a reply: who wrote it and its first lines; tapping it shows that message. */
function Quote({ quote, nameOf, mine, onPress }: { quote: ChatQuote; nameOf: (userId: string) => string; mine: boolean; onPress: () => void }) {
  const { who, what } = quoteLines(quote, nameOf);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={who ? `Reply to ${who}: ${what}` : what}
      disabled={!quote.available}
      onPress={onPress}
      className={`mb-0.5 rounded-xl border-l-4 border-primary bg-surface-raised px-3 py-1.5 active:opacity-70 dark:border-primary-dark dark:bg-surface-raised-dark ${mine ? 'self-end' : 'self-start'}`}>
      {who ? <Text className="text-xs font-bold text-primary dark:text-primary-dark">{who}</Text> : null}
      <Text numberOfLines={2} system={usesSystemFont(what)} className={`text-sm text-muted dark:text-muted-dark ${who ? '' : 'italic'}`}>
        {what}
      </Text>
    </Pressable>
  );
}

/** Above the composer while writing a reply: which message it answers, and a way to stop replying. */
function ReplyingBar({ quote, nameOf, onCancel, color }: { quote: ChatQuote; nameOf: (userId: string) => string; onCancel: () => void; color: string }) {
  const { who, what } = quoteLines(quote, nameOf);
  return (
    <View className="flex-row items-center gap-3 border-t border-border px-4 py-2 dark:border-border-dark">
      <View className="flex-1 border-l-4 border-primary pl-3 dark:border-primary-dark">
        <Text className="text-xs font-bold text-primary dark:text-primary-dark">Replying to {who}</Text>
        <Text numberOfLines={1} system={usesSystemFont(what)} className="text-sm text-muted dark:text-muted-dark">
          {what}
        </Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" hitSlop={10} onPress={onCancel} className="p-1 active:opacity-60">
        <Icon name="close" size={20} color={color} />
      </Pressable>
    </View>
  );
}

function MessageMenuButton({ onPress, color }: { onPress: () => void; color: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Message options" hitSlop={10} onPress={onPress} className="px-1 py-2 active:opacity-60">
      <Icon name="ellipsis-horizontal" size={16} color={color} />
    </Pressable>
  );
}
