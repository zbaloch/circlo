import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Avatar } from '@/components/avatar';
import { Button, ErrorText, TextField } from '@/components/form';
import { describeError } from '@/lib/account';
import { acceptInvite, createInviteLink, InviteError, requestByHandle } from '@/lib/friends';
import { displayName, useConnections } from '@/lib/use-connections';
import { usePalette } from '@/theme/use-palette';

function message(e: unknown) {
  return e instanceof InviteError ? e.message : describeError(e);
}

/** Find friends: share my invite (QR or link), use someone's invite, search by handle (opt-in), see friends. */
export default function SearchScreen() {
  const palette = usePalette();
  const { account, connections, refresh } = useConnections();
  const [link, setLink] = useState<string>();
  const [pasted, setPasted] = useState('');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState<'invite' | 'paste' | 'handle' | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  if (!account) return null;
  const friends = (connections ?? []).filter((c) => c.status === 'accepted');

  const run = async (kind: 'invite' | 'paste' | 'handle', fn: () => Promise<void>) => {
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

  return (
    <ScrollView
      className="flex-1 bg-surface dark:bg-surface-dark"
      contentContainerClassName="gap-6 p-5"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}>
      <View className="gap-3 rounded-2xl border border-border p-4 dark:border-border-dark">
        <Text className="text-lg font-bold text-ink dark:text-ink-dark">Invite a friend</Text>
        <Text className="text-muted dark:text-muted-dark">
          Show this code or send the link. It works once, for 7 days, and carries your key fingerprint so your friend’s
          app can check it’s really you.
        </Text>
        {link ? (
          <View className="items-center gap-3">
            <View className="rounded-xl bg-white p-3">
              <QRCode value={link} size={200} />
            </View>
            <Text selectable accessibilityLabel="Invite link" className="text-center text-sm text-muted dark:text-muted-dark">
              {link}
            </Text>
            <View className="w-full flex-row gap-3">
              <View className="flex-1">
                <Button label="Share link" onPress={() => Share.share({ message: `Join me on Halqo: ${link}` })} />
              </View>
              <View className="flex-1">
                <Button label="Copy" variant="outline" onPress={async () => { await Clipboard.setStringAsync(link); setNotice('Invite link copied.'); }} />
              </View>
            </View>
          </View>
        ) : (
          <Button label="Create invite" loading={busy === 'invite'} onPress={() => run('invite', async () => setLink(await createInviteLink(account)))} />
        )}
      </View>

      <View className="gap-3">
        <Text className="text-lg font-bold text-ink dark:text-ink-dark">Got an invite?</Text>
        <Button label="Scan QR code" variant="outline" onPress={() => router.push('/scan')} />
        <TextField label="Or paste an invite link" placeholder="https://halqo.com/i/…" value={pasted} onChangeText={setPasted} />
        <Button
          label="Send friend request"
          disabled={!pasted}
          loading={busy === 'paste'}
          onPress={() =>
            run('paste', async () => {
              await acceptInvite(account, pasted);
              setPasted('');
              setNotice('Friend request sent. You’ll see their profile once they accept.');
              await refresh();
            })
          }
        />
      </View>

      <View className="gap-3">
        <Text className="text-lg font-bold text-ink dark:text-ink-dark">Find by handle</Text>
        <TextField label="Handle" placeholder="exact handle" value={handle} onChangeText={setHandle} hint="Only finds people who turned on “Let people find me” in Settings." />
        <Button
          label="Send request"
          variant="outline"
          disabled={!handle}
          loading={busy === 'handle'}
          onPress={() =>
            run('handle', async () => {
              await requestByHandle(account, handle);
              setHandle('');
              setNotice('Friend request sent.');
              await refresh();
            })
          }
        />
      </View>

      <ErrorText>{error}</ErrorText>
      {notice ? <Text className="text-base text-primary dark:text-primary-dark">{notice}</Text> : null}

      <View className="gap-2">
        <Text className="text-lg font-bold text-ink dark:text-ink-dark">Friends ({friends.length})</Text>
        {friends.length === 0 ? <Text className="text-muted dark:text-muted-dark">No friends yet.</Text> : null}
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
    </ScrollView>
  );
}
