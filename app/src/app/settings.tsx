import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { api, ok } from '@/api/client';
import { Button, ErrorText } from '@/components/form';
import { authorName } from '@/components/post-actions';
import { describeError } from '@/lib/account';
import { useIntegrityWarning } from '@/lib/device-integrity';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { deleteAccount, exportMyData, unblockUser } from '@/lib/safety';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

/** Settings: discoverability, blocked people, export my data, delete my account. */
export default function SettingsScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const palette = usePalette();
  const integrity = useIntegrityWarning();
  const [discoverable, setDiscoverable] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [book, setBook] = useState<AddressBook | null>(null);
  const [error, setError] = useState<string>();
  const [exporting, setExporting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.GET('/v1/me/discoverable').then(
      (r) => {
        try {
          setDiscoverable(ok(r).discoverable);
        } catch (e) {
          setError(describeError(e));
        }
      },
      (e) => setError(describeError(e)),
    );
  }, []);

  const loadBlocks = useCallback(async () => {
    try {
      setBlocked(ok(await api.GET('/v1/blocks')).flatMap((b) => (b.userId ? [b.userId] : [])));
      if (account) setBook(await loadAddressBook(account));
    } catch (e) {
      setError(describeError(e));
    }
  }, [account]);
  useFocusEffect(
    useCallback(() => {
      loadBlocks();
    }, [loadBlocks]),
  );

  if (!account) return null;

  const toggle = async (value: boolean) => {
    setDiscoverable(value);
    try {
      ok(await api.PUT('/v1/me/discoverable', { body: { discoverable: value } }));
    } catch (e) {
      setDiscoverable(!value);
      setError(describeError(e));
    }
  };

  const runExport = async () => {
    setError(undefined);
    try {
      const name = await exportMyData(account, setExporting);
      Alert.alert('Export saved', `${name} is in the folder you chose. It isn’t encrypted, so keep it somewhere safe.`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setExporting(null);
    }
  };

  const runDelete = () =>
    Alert.alert('Delete your account?', 'Your posts, photos, replies, likes, friends, chats and keys are deleted from Halqo for good. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete forever',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteAccount(confirm.trim());
            await session.signOut();
          } catch (e) {
            setError(describeError(e));
            setDeleting(false);
          }
        },
      },
    ]);

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
      <View className="flex-row items-center gap-4 rounded-2xl border border-border p-4 dark:border-border-dark">
        <View className="flex-1 gap-1">
          <Text className="text-base font-bold text-ink dark:text-ink-dark">Let people find me by handle</Text>
          <Text className="text-muted dark:text-muted-dark">Off: only people you invite can add you. On: anyone who types your exact handle can send a request.</Text>
        </View>
        <Switch accessibilityLabel="Let people find me by handle" value={!!discoverable} disabled={discoverable === null} onValueChange={toggle} trackColor={{ true: palette.primary }} />
      </View>

      {integrity.message ? (
        <View className="gap-2 rounded-2xl border border-danger p-4 dark:border-danger-dark">
          <Text className="text-base font-bold text-ink dark:text-ink-dark">Device security</Text>
          <Text className="text-muted dark:text-muted-dark">{integrity.message}</Text>
        </View>
      ) : null}

      <View className="gap-2 rounded-2xl border border-border p-4 dark:border-border-dark">
        <Text className="text-base font-bold text-ink dark:text-ink-dark">Blocked people</Text>
        {blocked.length === 0 ? <Text className="text-muted dark:text-muted-dark">You haven’t blocked anyone.</Text> : null}
        {blocked.map((u) => (
          <View key={u} className="flex-row items-center justify-between py-1">
            <Text className="text-ink dark:text-ink-dark">{book?.contacts[u] ? authorName(account, book, u).name : 'Someone you blocked'}</Text>
            <Pressable accessibilityRole="button" onPress={() => unblockUser(u).then(loadBlocks, (e) => setError(describeError(e)))}>
              <Text className="font-semibold text-primary dark:text-primary-dark">Unblock</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View className="gap-2 rounded-2xl border border-border p-4 dark:border-border-dark">
        <Text className="text-base font-bold text-ink dark:text-ink-dark">Export my data</Text>
        <Text className="text-muted dark:text-muted-dark">
          Your profile, friends, posts (with photos) and chats, decrypted on this phone and saved as a file in a folder you pick. Nothing is sent to Halqo.
        </Text>
        <Button label={exporting ?? 'Export'} variant="outline" loading={!!exporting} onPress={runExport} />
      </View>

      <View className="gap-2 rounded-2xl border border-danger p-4 dark:border-danger-dark">
        <Text className="text-base font-bold text-danger dark:text-danger-dark">Delete account</Text>
        <Text className="text-muted dark:text-muted-dark">Deletes everything you have on Halqo. Type your handle ({account.handle}) to confirm.</Text>
        <TextInput
          accessibilityLabel="Type your handle to confirm"
          autoCapitalize="none"
          autoCorrect={false}
          value={confirm}
          onChangeText={setConfirm}
          placeholder={account.handle}
          placeholderTextColor={palette.muted}
          className="rounded-xl border border-border px-4 py-3 text-base text-ink dark:border-border-dark dark:text-ink-dark"
        />
        <Button label="Delete my account" disabled={confirm.trim().toLowerCase() !== account.handle.toLowerCase()} loading={deleting} onPress={runDelete} />
      </View>
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
