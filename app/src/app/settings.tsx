import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { api, ok } from '@/api/client';
import { Button, ErrorText } from '@/components/form';
import { authorName } from '@/components/post-actions';
import { describeError } from '@/lib/account';
import { useIntegrityWarning } from '@/lib/device-integrity';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { deleteAccount, exportMyData, unblockUser } from '@/lib/safety';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';
import { Text, TextInput } from '@/components/ui/text';
import { Toggle } from '@/components/ui/toggle';
import { showAlert } from '@/lib/dialog';

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
      showAlert('Export saved', `${name} is in the folder you chose. It isn’t encrypted, so keep it somewhere safe.`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setExporting(null);
    }
  };

  const runDelete = () =>
    showAlert('Delete your account?', 'Your posts, photos, replies, likes, friends, chats and keys are deleted from Halqo for good. This can’t be undone.', [
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
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="pb-10" keyboardShouldPersistTaps="handled">
      <Section title="Privacy">
        <Row title="Let people find me by handle" subtitle="Off: only people you invite can add you. On: anyone who types your exact handle can send a request.">
          <Toggle accessibilityLabel="Let people find me by handle" value={!!discoverable} disabled={discoverable === null} onValueChange={toggle} />
        </Row>
        {integrity.message ? <Row title="Device security" subtitle={integrity.message} danger /> : null}
      </Section>

      <Section title="Blocked people">
        {blocked.length === 0 ? <Row subtitle="You haven’t blocked anyone." /> : null}
        {blocked.map((u) => (
          <Row key={u} title={book?.contacts[u] ? authorName(account, book, u).name : 'Someone you blocked'}>
            <Pressable
              accessibilityRole="button"
              onPress={() => unblockUser(u).then(loadBlocks, (e) => setError(describeError(e)))}
              className="rounded-full border border-border px-4 py-1.5 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
              <Text className="text-sm font-bold text-ink dark:text-ink-dark">Unblock</Text>
            </Pressable>
          </Row>
        ))}
      </Section>

      <Section title="Your data">
        <Row title="Export my data" subtitle="Your profile, friends, posts (with photos) and chats, decrypted on this phone and saved as a file in a folder you pick. Nothing is sent to Halqo." />
        <View className="px-4 pb-4">
          <Button label={exporting ?? 'Export'} variant="outline" loading={!!exporting} onPress={runExport} />
        </View>
      </Section>

      <Section title="Delete account">
        <Row subtitle={`Deletes everything you have on Halqo: posts, photos, replies, likes, friends, chats and keys. Type your handle (${account.handle}) to confirm.`} />
        <View className="gap-3 px-4 pb-4">
          <TextInput
            accessibilityLabel="Type your handle to confirm"
            autoCapitalize="none"
            autoCorrect={false}
            value={confirm}
            onChangeText={setConfirm}
            placeholder={account.handle}
            placeholderTextColor={palette.muted}
            className="rounded-lg border border-border px-4 py-3 text-[15px] text-ink dark:border-border-dark dark:text-ink-dark"
          />
          <Button label="Delete my account" variant="danger" disabled={confirm.trim().toLowerCase() !== account.handle.toLowerCase()} loading={deleting} onPress={runDelete} />
        </View>
      </Section>
      <View className="px-4">
        <ErrorText>{error}</ErrorText>
      </View>
    </ScrollView>
  );
}

/** A settings group: small heading, rows separated by a hairline (X style). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="border-b border-border dark:border-border-dark">
      <Text accessibilityRole="header" className="px-4 pb-1 pt-5 text-xl font-extrabold text-ink dark:text-ink-dark">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({ title, subtitle, danger = false, children }: { title?: string; subtitle?: string; danger?: boolean; children?: ReactNode }) {
  return (
    <View className="flex-row items-center gap-4 px-4 py-3">
      <View className="flex-1 gap-0.5">
        {title ? <Text className={`text-[15px] font-semibold ${danger ? 'text-danger dark:text-danger-dark' : 'text-ink dark:text-ink-dark'}`}>{title}</Text> : null}
        {subtitle ? <Text className="text-[13px] leading-[18px] text-muted dark:text-muted-dark">{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}
