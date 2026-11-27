import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { useBlocked, visibleConversations } from '@/lib/blocks';
import { memberName, sendMessage, syncMessaging, useConversations, type Conversation } from '@/lib/messaging';
import type { StoredAccount } from '@/lib/keystore';
import { showToast } from '@/lib/toast';
import { chatTitle } from '@/lib/view-logic';

/**
 * Sends a link to one of my chats (Reading's "Send in a chat"): the chats I'm in, newest first. The message is the
 * link, as if I'd pasted it, so the people in the chat see exactly what I picked and nothing about what I follow.
 */
export function SendToChatSheet({ account, text, onClose }: { account: StoredAccount; text: string | null; onClose: () => void }) {
  const blocked = useBlocked();
  const all = useConversations();
  const chats = useMemo(() => visibleConversations(all, blocked), [all, blocked]);
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const loading = !!text && syncedFor !== text;

  // Fresh chats each time it opens.
  useEffect(() => {
    if (!text) return;
    syncMessaging(account).catch(() => undefined).finally(() => setSyncedFor(text));
  }, [account, text]);

  const title = (c: Conversation) => c.name || chatTitle(c.members.map((u) => memberName(c, u, account)));
  const send = async (c: Conversation) => {
    if (!text || sending) return;
    setSending(c.groupId);
    try {
      await sendMessage(account, c.groupId, text);
      showToast(`Sent to ${title(c)}`);
      onClose();
    } catch {
      showToast('Couldn’t send it. Try again.');
    } finally {
      setSending(null);
    }
  };

  return (
    <Modal visible={!!text} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[70%] rounded-t-3xl bg-surface pb-8 pt-3 dark:bg-surface-dark">
        <View className="items-center pb-2">
          <View className="h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
        </View>
        <Text className="px-5 pb-2 text-base font-bold text-ink dark:text-ink-dark">Send in a chat</Text>
        {chats.length === 0 ? (
          loading ? (
            <Spinner className="py-6" />
          ) : (
            <Text className="px-5 py-4 text-muted dark:text-muted-dark">You have no chats yet. Start one from Messages.</Text>
          )
        ) : (
          <ScrollView>
            {chats.map((c) => (
              <Pressable
                key={c.groupId}
                accessibilityRole="button"
                accessibilityLabel={`Send to ${title(c)}`}
                disabled={!!sending}
                onPress={() => void send(c)}
                className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
                <Avatar id={c.members.length === 1 ? c.members[0] : c.groupId} name={title(c)} uri={c.members.length === 1 ? c.people[c.members[0]]?.avatarUrl : undefined} />
                <Text numberOfLines={1} className="flex-1 text-base text-ink dark:text-ink-dark">{title(c)}</Text>
                {sending === c.groupId ? <Spinner /> : null}
              </Pressable>
            ))}
          </ScrollView>
        )}
        <Pressable accessibilityRole="button" onPress={onClose} className="mx-5 mt-2 items-center rounded-full border border-border py-3 dark:border-border-dark">
          <Text className="text-base text-ink dark:text-ink-dark">Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
