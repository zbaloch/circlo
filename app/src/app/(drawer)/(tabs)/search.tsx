import { Icon } from '@/components/ui/icon';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { CirclePickerSheet, circlesLine } from '@/components/circle-choice';
import { Avatar } from '@/components/avatar';
import { Button, ErrorText, TextField } from '@/components/form';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { setCircles } from '@/lib/circles';
import { showAlert } from '@/lib/dialog';
import { acceptRequest, declineRequest, getInviteLink, InviteError, joinInvite, justJoined, previewInvite, resetInviteLink, type Connection } from '@/lib/friends';
import { takePendingInvite } from '@/lib/pending-invite';
import { displayName, markRequestsSeen, useConnections } from '@/lib/use-connections';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';

/** While my QR code is on screen, check this often for people who scan it. */
const INVITE_POLL_MS = 3_000;

type Section = 'friends' | 'join' | 'invite';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'friends', label: 'My People' },
  { key: 'join', label: 'Got an invite?' },
  { key: 'invite', label: 'Invite someone' },
];

function message(e: unknown) {
  return e instanceof InviteError ? e.message : describeError(e);
}

/**
 * Friends, in three tabs: Friends (requests to answer, requests I sent, my friends), Got an invite? (scan or paste
 * someone's), and Invite someone (my QR code and link, the same until I reset it). Invites are the only way to
 * connect; there is no search. Whoever scans my code while it's on screen shows up above it, to choose their circles.
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
  const [link, setLink] = useState<string>();
  // Who I was connected with when my code went on screen: anyone new since then just joined.
  const [known, setKnown] = useState<ReadonlySet<string> | null>(null);
  // An invite link that opened the app waits here, ready to send.
  const [pasted, setPasted] = useState(() => takePendingInvite() ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  // Asked before accepting a request or sending a pasted invite: which circles the person goes into (author-only;
  // none keeps them in Everyone only).
  const [book, setBook] = useState<AddressBook | null>(null);
  const [ask, setAsk] = useState<{ title: string; confirmLabel: string; done: (ids: number[]) => void }>();
  const askCircles = (title: string, confirmLabel: string, done: (ids: number[]) => void) => {
    if (book) setAsk({ title, confirmLabel, done });
    else done([]);
  };

  useFocusEffect(
    useCallback(() => {
      if (account) loadAddressBook(account).then(setBook, () => {});
    }, [account]),
  );

  const all = connections ?? [];
  const incoming = all.filter((c) => c.status === 'incoming');
  const outgoing = all.filter((c) => c.status === 'outgoing');
  const friends = all.filter((c) => c.status === 'accepted');
  const joiners = section === 'invite' ? justJoined(all, known) : [];

  // Requests are visible here, so they count as seen (clears the bell's dot).
  const unseenKey = unseenRequests.join(',');
  useFocusEffect(
    useCallback(() => {
      if (account && unseenKey) markRequestsSeen(account);
    }, [account, unseenKey]),
  );

  // My link, fetched when its tab opens; who I'm connected with then is noted so new joiners stand out.
  const showingInvite = section === 'invite' && !!connections;
  useEffect(() => {
    if (!showingInvite || link) return;
    getInviteLink().then(setLink, (e) => setError(message(e)));
  }, [showingInvite, link]);
  if (showingInvite && !known && connections) setKnown(new Set(connections.map((c) => c.userId)));
  // Watch for scans while the QR code is on screen.
  useFocusEffect(
    useCallback(() => {
      if (!showingInvite) return;
      const timer = setInterval(() => void refresh(), INVITE_POLL_MS);
      return () => clearInterval(timer);
    }, [showingInvite, refresh]),
  );

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

  const accept = (c: Connection, circles: number[]) =>
    run(`accept:${c.userId}`, async () => {
      await acceptRequest(account, c.userId, circles);
      await refresh();
      if (book) setNotice(`You and ${displayName(c)} are now connected${circles.length ? `, in ${circlesLine(book, circles)}` : ''}.`);
      else setNotice(`You and ${displayName(c)} are now connected.`);
    });

  const requestActions = (c: Connection) => (
    <View className="gap-3">
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button
            label="Accept"
            loading={busy === `accept:${c.userId}`}
            disabled={!!busy}
            onPress={() => askCircles(`Add ${displayName(c)} to circles`, 'Accept', (ids) => void accept(c, ids))}
          />
        </View>
        <View className="flex-1">
          <Button
            label="Decline"
            variant="outline"
            loading={busy === `decline:${c.userId}`}
            disabled={!!busy}
            onPress={() => run(`decline:${c.userId}`, async () => {
              await declineRequest(account, c.userId);
              await refresh();
            })}
          />
        </View>
      </View>
    </View>
  );

  const reset = () =>
    showAlert('Reset your invite link?', 'Your current link and QR code will stop working. People who already joined stay connected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => void run('reset', async () => { setLink(await resetInviteLink()); setNotice('You have a new invite link.'); }) },
    ]);

  // Someone's invite: see who it's from, choose their circles, then connect.
  const connectWith = (text: string) =>
    run('paste', async () => {
      const from = await previewInvite(text);
      const name = from.name || `@${from.handle}`;
      askCircles(`Add ${name} to circles`, 'Connect', (ids) =>
        void run('paste', async () => {
          const status = await joinInvite(account, text, ids);
          setPasted('');
          setNotice(status === 'accepted' ? `You and ${name} are now connected.` : 'Request sent. You’ll see their profile once they accept.');
          await refresh();
        }),
      );
    });

  const chooseFor = (c: Connection) =>
    askCircles(`Add ${displayName(c)} to circles`, 'Save', (ids) =>
      void run(`circles:${c.userId}`, async () => {
        await setCircles(account, c.userId, ids);
        setBook(await loadAddressBook(account));
        setNotice(ids.length && book ? `${displayName(c)} is in ${circlesLine(book, ids)}.` : `${displayName(c)} sees your Everyone posts.`);
      }),
    );


  const pick = (t: Section) => {
    setSection(t);
    setError(undefined);
    setNotice(undefined);
  };
  // A dot on a section with something waiting: requests in Friends.
  const dots: Record<Section, boolean> = {
    friends: incoming.length > 0,
    join: false,
    invite: false,
  };

  const tabLabel = (t: { key: Section; label: string }) => (t.key === 'friends' ? `${t.label} (${friends.length})` : t.label);

  const feedback = (
    <>
      <ErrorText>{error}</ErrorText>
      {notice ? <Text className="text-base text-primary dark:text-primary-dark">{notice}</Text> : null}
    </>
  );

  const friendsSection = (
    <>
      {incoming.length > 0 ? (
        <View className="gap-3">
          <Text className="text-lg font-bold text-ink dark:text-ink-dark">Requests ({incoming.length})</Text>
          {incoming.map((c) => (
            <View key={c.userId} className="gap-3 rounded-2xl border border-border p-4 dark:border-border-dark">
              <View className="flex-row items-center gap-3">
                <Avatar id={c.userId} name={displayName(c)} uri={c.profile.avatarUrl} />
                <View className="flex-1">
                  <Text className="font-bold text-ink dark:text-ink-dark">{displayName(c)}</Text>
                  <Text className="text-muted dark:text-muted-dark">
                    {c.profile?.handle ? `@${c.profile.handle} · ` : ''}wants to connect
                  </Text>
                </View>
              </View>

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
              <Avatar id={c.userId} name={displayName(c)} uri={c.profile.avatarUrl} />
              <View className="flex-1">
                <Text className="font-bold text-ink dark:text-ink-dark">{c.profile ? displayName(c) : 'Request sent'}</Text>
                <Text className="text-muted dark:text-muted-dark">Waiting for them to accept</Text>
              </View>
              <Icon name="time-outline" size={20} color={palette.muted} />
            </View>
          ))}
        </View>
      ) : null}

      <View className="gap-2">
        {friends.length === 0 ? (
          <View className="items-start gap-3">
            <Text className="text-muted dark:text-muted-dark">No one here yet. Invite someone, or use an invite you were sent.</Text>
            <Button label="Invite someone" onPress={() => pick('invite')} />
          </View>
        ) : null}
        {friends.map((f) => (
          <Pressable
            key={f.userId}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/friend/[id]', params: { id: f.userId } })}
            className="flex-row items-center gap-3 py-2 active:opacity-60">
            <Avatar id={f.userId} name={displayName(f)} uri={f.profile.avatarUrl} />
            <View className="flex-1">
              <Text className="font-bold text-ink dark:text-ink-dark">{displayName(f)}</Text>
              <Text className="text-muted dark:text-muted-dark">@{f.profile.handle}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </>
  );

  const joinSection = (
    <>
      <Text className="text-muted dark:text-muted-dark">
        Scan the QR code someone shows you, or paste the invite link they sent. You’ll choose their circles, then you’re connected.
      </Text>
      {Platform.OS !== 'web' ? <Button label="Scan QR code" onPress={() => router.push('/scan')} /> : null}
      <TextField label={Platform.OS === 'web' ? 'Paste the invite link' : 'Or paste an invite link'} placeholder="https://www.hellocirclo.com/i/…" value={pasted} onChangeText={setPasted} />
      <Button label="Connect" variant="outline" disabled={!pasted} loading={busy === 'paste'} onPress={() => void connectWith(pasted)} />
      {feedback}
    </>
  );

  const inviteSection = (
    <View className="items-center gap-3">
      {joiners.map((c) => (
        <View key={c.userId} className="w-full flex-row items-center gap-3 rounded-2xl border border-border p-4 dark:border-border-dark">
          <Avatar id={c.userId} name={displayName(c)} uri={c.profile.avatarUrl} />
          <View className="flex-1">
            <Text className="font-bold text-ink dark:text-ink-dark">{displayName(c)} joined</Text>
            <Text className="text-muted dark:text-muted-dark">You’re connected. They see your Everyone posts.</Text>
          </View>
          <Button label="Circles" variant="outline" loading={busy === `circles:${c.userId}`} disabled={!!busy} onPress={() => chooseFor(c)} />
        </View>
      ))}
      <Text className="self-start text-muted dark:text-muted-dark">
        Show this code to someone, or send them your link. Anyone who opens it is connected with you and sees your Everyone
        posts; you’ll be told, and can choose their circles. It stays the same until you reset it.
      </Text>
      {link ? (
        <>
          <View className="rounded-xl bg-white p-3">
            <QRCode value={link} size={200} />
          </View>
          <Text selectable accessibilityLabel="Invite link" className="text-center text-sm text-muted dark:text-muted-dark">
            {link}
          </Text>
          <View className="w-full flex-row gap-3">
            <View className="flex-1">
              <Button label="Share link" onPress={() => Share.share({ message: `Join me on Circlo: ${link}` })} />
            </View>
            <View className="flex-1">
              <Button label="Copy" variant="outline" onPress={async () => { await Clipboard.setStringAsync(link); setNotice('Invite link copied.'); }} />
            </View>
          </View>
          <Button label="Reset link" variant="outline" loading={busy === 'reset'} disabled={!!busy} onPress={reset} />
        </>
      ) : null}
      <View className="self-stretch">{feedback}</View>
    </View>
  );

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <View accessibilityRole="tablist" className="flex-row border-b border-border dark:border-border-dark">
        {SECTIONS.map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === t.key }}
            accessibilityLabel={dots[t.key] ? `${tabLabel(t)}, new` : tabLabel(t)}
            onPress={() => pick(t.key)}
            className="flex-1 items-center pt-3 active:opacity-60">
            <View className="flex-row items-center gap-1.5">
              <Text className={section === t.key ? 'font-bold text-ink dark:text-ink-dark' : 'text-muted dark:text-muted-dark'}>
                {tabLabel(t)}
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
      {ask && book ? (
        <CirclePickerSheet
          visible
          book={book}
          selected={[]}
          title={ask.title}
          confirmLabel={ask.confirmLabel}
          onDone={ask.done}
          onClose={() => setAsk(undefined)}
        />
      ) : null}
    </View>
  );
}
