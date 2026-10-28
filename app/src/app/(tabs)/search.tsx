import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { CircleChoice } from '@/components/circle-choice';
import { Avatar } from '@/components/avatar';
import { Button, ErrorText, TextField } from '@/components/form';
import { describeError } from '@/lib/account';
import { loadAddressBook, NEW_FRIEND_CIRCLE, type AddressBook } from '@/lib/addressbook';
import { labelOf } from '@/lib/circles';
import { acceptInvite, acceptRequest, createInviteLink, declineRequest, InviteError, type Connection } from '@/lib/friends';
import { displayName, markRequestsSeen, useConnections } from '@/lib/use-connections';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';

/** While my QR code is on screen, check this often for the person who scans it. */
const INVITE_POLL_MS = 3_000;

type Section = 'friends' | 'join' | 'invite';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'friends', label: 'Friends' },
  { key: 'join', label: 'Got an invite?' },
  { key: 'invite', label: 'Invite a friend' },
];

function message(e: unknown) {
  return e instanceof InviteError ? e.message : describeError(e);
}

/**
 * Friends, in three tabs: Friends (requests to answer, requests I sent, my friends), Got an invite? (scan or paste
 * someone's), and Invite a friend (my QR code and link). Invites are the only way to connect; there is no search.
 * When someone scans my code, their request replaces the QR code so I can accept it right there.
 */
export default function SearchScreen() {
  const palette = usePalette();
  const { account, connections, unseenRequests, refresh } = useConnections();
  // Links can open a given tab (Home's "Invite your first friend", a request in Notifications).
  const { section: requested } = useLocalSearchParams<{ section?: string }>();
  const asSection = (s?: string) => SECTIONS.find((x) => x.key === s)?.key;
  const [section, setSection] = useState<Section>(asSection(requested) ?? 'friends');
  const [lastRequested, setLastRequested] = useState(requested);
  if (requested !== lastRequested) {
    setLastRequested(requested);
    const next = asSection(requested);
    if (next) setSection(next);
  }
  const [invite, setInvite] = useState<{ link: string; known: ReadonlySet<string> }>();
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  // Where each request will go when accepted (author-only; defaults to NEW_FRIEND_CIRCLE).
  const [book, setBook] = useState<AddressBook | null>(null);
  const [placement, setPlacement] = useState<Record<string, number>>({});
  const circleFor = (userId: string) => placement[userId] ?? NEW_FRIEND_CIRCLE;
  // Where someone whose invite I use goes (author-only; defaults to NEW_FRIEND_CIRCLE).
  const [joinCircle, setJoinCircle] = useState(NEW_FRIEND_CIRCLE);

  useFocusEffect(
    useCallback(() => {
      if (account) loadAddressBook(account).then(setBook, () => {});
    }, [account]),
  );

  const all = connections ?? [];
  const incoming = all.filter((c) => c.status === 'incoming');
  const outgoing = all.filter((c) => c.status === 'outgoing');
  const friends = all.filter((c) => c.status === 'accepted');
  // The person who used my current invite: anyone new since I created it who asked me (not someone I asked).
  const scanner = invite ? all.find((c) => c.status !== 'outgoing' && !invite.known.has(c.userId)) : undefined;
  const otherRequests = incoming.filter((c) => c.userId !== scanner?.userId);

  // Requests are visible here, so they count as seen (clears the bell's dot).
  const unseenKey = unseenRequests.join(',');
  useFocusEffect(
    useCallback(() => {
      if (account && unseenKey) markRequestsSeen(account);
    }, [account, unseenKey]),
  );

  // Watch for the scan while the QR code is showing.
  const waiting = !!invite && !scanner;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh(), INVITE_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  if (!account) return null;

  const run = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const requestActions = (c: Connection) => (
    <View className="gap-3">
      {book ? (
        <CircleChoice book={book} value={circleFor(c.userId)} onChange={(n) => setPlacement((p) => ({ ...p, [c.userId]: n }))} />
      ) : null}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button
            label="Accept"
            loading={busy === `accept:${c.userId}`}
            disabled={!!busy}
            onPress={() => run(`accept:${c.userId}`, async () => {
              const circle = circleFor(c.userId);
              await acceptRequest(account, c.userId, circle);
              await refresh();
              if (book) setNotice(`You and ${displayName(c)} are now friends, in ${labelOf(book, circle)}.`);
              else setNotice(`You and ${displayName(c)} are now friends.`);
            })}
          />
        </View>
        <View className="flex-1">
          <Button
            label="Decline"
            variant="outline"
            loading={busy === `decline:${c.userId}`}
            disabled={!!busy}
            onPress={() => run(`decline:${c.userId}`, async () => {
              await declineRequest(c.userId);
              await refresh();
            })}
          />
        </View>
      </View>
    </View>
  );

  const keysWarning = (c: Connection) =>
    c.identityChanged ? (
      <Text className="text-danger dark:text-danger-dark">Their security keys changed since you last saw them.</Text>
    ) : null;

  const newInvite = () =>
    run('invite', async () => {
      const link = await createInviteLink(account);
      setInvite({ link, known: new Set(all.map((c) => c.userId)) });
    });


  const pick = (t: Section) => {
    setSection(t);
    setError(undefined);
    setNotice(undefined);
  };
  // A dot on a section with something waiting: requests in Friends, the scanner's request in Invite a friend.
  const dots: Record<Section, boolean> = {
    friends: otherRequests.length > 0,
    join: false,
    invite: scanner?.status === 'incoming',
  };

  const feedback = (
    <>
      <ErrorText>{error}</ErrorText>
      {notice ? <Text className="text-base text-primary dark:text-primary-dark">{notice}</Text> : null}
    </>
  );

  const friendsSection = (
    <>
      {otherRequests.length > 0 ? (
        <View className="gap-3">
          <Text className="text-lg font-bold text-ink dark:text-ink-dark">Requests ({otherRequests.length})</Text>
          {otherRequests.map((c) => (
            <View key={c.userId} className="gap-3 rounded-2xl border border-border p-4 dark:border-border-dark">
              <View className="flex-row items-center gap-3">
                <Avatar name={displayName(c)} />
                <View className="flex-1">
                  <Text className="font-bold text-ink dark:text-ink-dark">{displayName(c)}</Text>
                  <Text className="text-muted dark:text-muted-dark">
                    {c.profile?.handle ? `@${c.profile.handle} · ` : ''}wants to be friends
                  </Text>
                </View>
              </View>
              {keysWarning(c)}
              {requestActions(c)}
            </View>
          ))}
        </View>
      ) : null}

      {feedback}

      {outgoing.length > 0 ? (
        <View className="gap-2">
          <Text className="text-lg font-bold text-ink dark:text-ink-dark">Sent ({outgoing.length})</Text>
          {outgoing.map((c) => (
            <View key={c.userId} className="flex-row items-center gap-3 py-2">
              <Avatar name={c.profile ? displayName(c) : '?'} />
              <View className="flex-1">
                <Text className="font-bold text-ink dark:text-ink-dark">{c.profile ? displayName(c) : 'Request sent'}</Text>
                <Text className="text-muted dark:text-muted-dark">Waiting for them to accept</Text>
              </View>
              <Ionicons name="time-outline" size={20} color={palette.muted} />
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="text-lg font-bold text-ink dark:text-ink-dark">Your friends ({friends.length})</Text>
        {friends.length === 0 ? (
          <View className="items-start gap-3">
            <Text className="text-muted dark:text-muted-dark">No friends yet. Invite someone, or use an invite you were sent.</Text>
            <Button label="Invite a friend" onPress={() => pick('invite')} />
          </View>
        ) : null}
        {friends.map((f) => (
          <Pressable
            key={f.userId}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/friend/[id]', params: { id: f.userId } })}
            className="flex-row items-center gap-3 py-2 active:opacity-60">
            <Avatar name={displayName(f)} />
            <View className="flex-1">
              <Text className="font-bold text-ink dark:text-ink-dark">{displayName(f)}</Text>
              {f.profile?.handle ? <Text className="text-muted dark:text-muted-dark">@{f.profile.handle}</Text> : null}
            </View>
            {f.identityChanged ? (
              <Ionicons name="warning" size={20} color={palette.danger} accessibilityLabel="Security keys changed" />
            ) : f.verified ? (
              <Ionicons name="shield-checkmark" size={20} color={palette.primary} accessibilityLabel="Verified" />
            ) : null}
          </Pressable>
        ))}
      </View>
    </>
  );

  const joinSection = (
    <>
      <Text className="text-muted dark:text-muted-dark">
        Scan the QR code a friend shows you, or paste the invite link they sent. Choose their circle first; they’ll get your request to accept.
      </Text>
      {book ? <CircleChoice book={book} value={joinCircle} onChange={setJoinCircle} label="Put them in circle" /> : null}
      <Button label="Scan QR code" onPress={() => router.push({ pathname: '/scan', params: { circle: String(joinCircle) } })} />
      <TextField label="Or paste an invite link" placeholder="https://circlo.com/i/…" value={pasted} onChangeText={setPasted} />
      <Button
        label="Send friend request"
        variant="outline"
        disabled={!pasted}
        loading={busy === 'paste'}
        onPress={() =>
          run('paste', async () => {
            await acceptInvite(account, pasted, joinCircle);
            setPasted('');
            setNotice('Friend request sent. You’ll see their profile once they accept.');
            await refresh();
          })
        }
      />
      {feedback}
    </>
  );

  const inviteSection = scanner ? (
    <>
      <View className="flex-row items-center gap-3">
        <Avatar name={displayName(scanner)} />
        <View className="flex-1">
          <Text className="font-bold text-ink dark:text-ink-dark">{displayName(scanner)} used your invite</Text>
          <Text className="text-muted dark:text-muted-dark">
            {scanner.status === 'accepted' ? 'You’re now friends.' : 'Accept their request to become friends.'}
          </Text>
        </View>
        <Ionicons name="checkmark-circle" size={26} color={palette.primary} />
      </View>
      {scanner.status === 'incoming' ? (
        <>
          {keysWarning(scanner)}
          {requestActions(scanner)}
        </>
      ) : null}
      {feedback}
      <Button label="Invite someone else" variant="outline" loading={busy === 'invite'} onPress={newInvite} />
    </>
  ) : invite ? (
    <View className="items-center gap-3">
      <Text className="self-start text-muted dark:text-muted-dark">
        Ask your friend to scan this in Circlo. Their request will show up here for you to accept.
      </Text>
      <View className="rounded-xl bg-white p-3">
        <QRCode value={invite.link} size={200} />
      </View>
      <View className="flex-row items-center gap-2">
        <Ionicons name="hourglass-outline" size={16} color={palette.muted} />
        <Text className="text-sm text-muted dark:text-muted-dark">Waiting for someone to use it…</Text>
      </View>
      <Text selectable accessibilityLabel="Invite link" className="text-center text-sm text-muted dark:text-muted-dark">
        {invite.link}
      </Text>
      <View className="w-full flex-row gap-3">
        <View className="flex-1">
          <Button label="Share link" onPress={() => Share.share({ message: `Join me on Circlo: ${invite.link}` })} />
        </View>
        <View className="flex-1">
          <Button label="Copy" variant="outline" onPress={async () => { await Clipboard.setStringAsync(invite.link); setNotice('Invite link copied.'); }} />
        </View>
      </View>
      <View className="self-stretch">{feedback}</View>
    </View>
  ) : (
    <>
      <Text className="text-muted dark:text-muted-dark">
        Create a one-time invite to add someone. You’ll get a QR code to show them in person and a link you can send.
        Each invite works once, for 7 days, and lets your friend’s app check it’s really you.
      </Text>
      <Button label="Create invite" loading={busy === 'invite'} disabled={!connections} onPress={newInvite} />
      {feedback}
    </>
  );

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <View accessibilityRole="tablist" className="flex-row border-b border-border dark:border-border-dark">
        {SECTIONS.map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === t.key }}
            accessibilityLabel={dots[t.key] ? `${t.label}, new` : t.label}
            onPress={() => pick(t.key)}
            className="flex-1 items-center pt-3 active:opacity-60">
            <View className="flex-row items-center gap-1.5">
              <Text className={section === t.key ? 'font-bold text-ink dark:text-ink-dark' : 'text-muted dark:text-muted-dark'}>
                {t.label}
              </Text>
              {dots[t.key] ? <View className="h-2 w-2 rounded-full bg-primary dark:bg-primary-dark" /> : null}
            </View>
            <View className={`mt-3 h-1 w-14 rounded-full ${section === t.key ? 'bg-primary dark:bg-primary-dark' : 'bg-transparent'}`} />
          </Pressable>
        ))}
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-5 p-5"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}>
        {section === 'friends' ? friendsSection : section === 'join' ? joinSection : inviteSection}
      </ScrollView>
    </View>
  );
}
