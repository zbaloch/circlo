import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ChoiceRow } from '@/components/audience-sheet';
import { Button, ErrorText, TextField } from '@/components/form';
import { authorName } from '@/components/post-actions';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { blockUser } from '@/lib/blocks';
import { showAlert } from '@/lib/dialog';
import { getPost } from '@/lib/feed-store';
import { useConversations } from '@/lib/messaging';
import { REPORT_REASONS, reportMessage, reportPost, reportUser, type ReportReason } from '@/lib/report';
import { useSession } from '@/lib/session';
import { displayName, useConnections } from '@/lib/use-connections';
import { usePalette } from '@/theme/use-palette';

type Kind = 'post' | 'user' | 'message';

const COPY: Record<Kind, { title: string; question: string; includes: string; gone: string }> = {
  post: { title: 'Report post', question: 'What’s wrong with this post?', includes: 'this post’s text and photos', gone: 'This post isn’t available any more.' },
  user: { title: 'Report account', question: 'What’s wrong with this account?', includes: 'their name, handle and bio', gone: 'This account isn’t available any more.' },
  message: { title: 'Report message', question: 'What’s wrong with this message?', includes: 'this message’s text and photos (not the rest of the chat)', gone: 'This message isn’t available any more.' },
};

/**
 * Report a post, a person or a chat message (PLAN.md Phase 11). What the reporter sees is sealed on this device so
 * only Circlo's moderators can read it; the person reported isn't told. `id` is the post id, the user id, or the chat
 * id (with `seq` for the message).
 */
export default function ReportScreen() {
  const params = useLocalSearchParams<{ id: string; kind?: Kind; seq?: string }>();
  const kind: Kind = params.kind === 'user' || params.kind === 'message' ? params.kind : 'post';
  const session = useSession();
  const palette = usePalette();
  const account = session.status === 'signedIn' ? session.account : null;
  const { connections } = useConnections();
  const conversations = useConversations();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (account) loadAddressBook(account).then(setBook, () => {});
  }, [account]);
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ title: COPY[kind].title });
  }, [navigation, kind]);

  const post = kind === 'post' ? getPost(params.id) : undefined;
  const connection = kind === 'user' ? connections?.find((c) => c.userId === params.id) : undefined;
  const message = kind === 'message' ? conversations.find((c) => c.groupId === params.id)?.messages.find((m) => String(m.seq) === params.seq) : undefined;
  // Whoever the report is about, so the reporter can block them afterwards.
  const subjectId = post?.authorId ?? connection?.userId ?? message?.senderUser;
  const subjectName = !account || !subjectId ? '' : connection ? displayName(connection) : authorName(account, book, subjectId).name;

  if (!account || !subjectId || subjectId === account.userId) {
    return (
      <View className="flex-1 bg-surface p-5 dark:bg-surface-dark">
        <Text className="text-muted dark:text-muted-dark">{COPY[kind].gone}</Text>
      </View>
    );
  }

  if (sent) {
    const block = () =>
      showAlert(`Block ${subjectName}?`, 'You’ll stop being connected. They can’t send you requests or see anything new you post, and their messages are hidden. They aren’t told.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => blockUser(account, subjectId).then(() => setBlocked(true), (e) => showAlert('Couldn’t block', describeError(e))),
        },
      ]);
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-surface px-8 dark:bg-surface-dark">
        <Icon name="shield-checkmark" size={40} color={palette.primary} />
        <Text className="text-center text-2xl font-bold text-ink dark:text-ink-dark">Thanks for telling us</Text>
        <Text className="text-center text-base text-muted dark:text-muted-dark">
          Circlo’s moderators will look at it. {subjectName} isn’t told you reported them.
        </Text>
        <View className="mt-3 gap-3 self-stretch">
          {blocked ? (
            <Text className="text-center text-base text-ink dark:text-ink-dark">You blocked {subjectName}.</Text>
          ) : (
            <Button label={`Block ${subjectName}`} variant="danger" onPress={block} />
          )}
          <Button label="Done" variant={blocked ? 'primary' : 'outline'} onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError(undefined);
    try {
      const b = book ?? (await loadAddressBook(account));
      if (post) await reportPost(account, post, authorName(account, b, post.authorId), reason, note);
      else if (message) await reportMessage(account, params.id, message, authorName(account, b, message.senderUser), reason, note);
      else if (connection) {
        const p = connection.profile;
        await reportUser(account, { userId: connection.userId, name: p?.displayName, handle: p?.handle, bio: p?.bio }, reason, note);
      }
      setSent(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="gap-2 pb-10 pt-3" keyboardShouldPersistTaps="handled">
      <Text className="px-5 pb-1 text-xl font-bold text-ink dark:text-ink-dark">{COPY[kind].question}</Text>
      {REPORT_REASONS.map((r) => (
        <ChoiceRow key={r.id} badge={null} title={r.label} checked={reason === r.id} onPress={() => setReason(r.id)} />
      ))}
      <View className="gap-3 px-5 pt-3">
        <TextField label="Anything else? (optional)" value={note} onChangeText={setNote} maxLength={1000} multiline />
        <View className="flex-row gap-2">
          <Icon name="lock-closed-outline" size={16} color={palette.muted} />
          <Text className="flex-1 text-sm text-muted dark:text-muted-dark">
            Your report includes {COPY[kind].includes}, decrypted on your phone and sealed so only Circlo’s moderators can
            read it. {subjectName} isn’t told.
          </Text>
        </View>
        <ErrorText>{error}</ErrorText>
        <Button label="Send report" disabled={!reason} loading={busy} onPress={send} />
      </View>
    </ScrollView>
  );
}
