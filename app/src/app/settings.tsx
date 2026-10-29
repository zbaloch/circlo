import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { authorName } from '@/components/post-actions';
import { Icon } from '@/components/ui/icon';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { refreshBlocked, unblockUser, useBlocked } from '@/lib/blocks';
import { LINKS, openLink } from '@/lib/links';
import { useIntegrityWarning } from '@/lib/device-integrity';
import { enablePush, pushPermission, type PushPermission } from '@/lib/push';
import { deleteAccount, exportMyData } from '@/lib/safety';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';
import { Text, TextInput } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';

/** Settings: notifications, privacy, blocked people, export my data, delete my account, and Circlo's terms, privacy and support. */
export default function SettingsScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const palette = usePalette();
  const integrity = useIntegrityWarning();
  const [error, setError] = useState<string>();
  const blocked = useBlocked();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [push, setPush] = useState<PushPermission | null>(null);

  useFocusEffect(
    useCallback(() => {
      refreshBlocked().catch((e) => setError(describeError(e)));
      pushPermission().then(setPush, () => {});
      if (account) loadAddressBook(account).then(setBook, () => {});
    }, [account]),
  );

  if (!account) return null;

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
    showAlert('Delete your account?', 'Your posts, photos, replies, likes, people, chats and keys are deleted from Circlo for good. This can’t be undone.', [
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
      <Section title="Notifications">
        {push === 'on' ? <Row title="Notifications are on" subtitle={PUSH_NOTE} /> : null}
        {push === 'ask' || push === 'blocked' ? (
          <Row title="Notifications are off" subtitle={push === 'blocked' ? `Turn them on in your phone’s settings. ${PUSH_NOTE}` : PUSH_NOTE}>
            <Pressable
              accessibilityRole="button"
              onPress={() => enablePush(account).then(setPush, (e) => setError(describeError(e)))}
              className="rounded-full bg-primary px-4 py-1.5 active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark">
              <Text className="text-sm font-bold text-on-primary dark:text-on-primary-dark">{push === 'blocked' ? 'Open settings' : 'Turn on'}</Text>
            </Pressable>
          </Row>
        ) : null}
      </Section>

      <Section title="Privacy">
        <Row title="Only people you invite can add you" subtitle="No one can search for you. People connect by scanning your QR code or opening your invite link." />
        {integrity.message ? <Row title="Device security" subtitle={integrity.message} danger /> : null}
      </Section>

      <Section title="Blocked people">
        {blocked.size === 0 ? <Row subtitle="You haven’t blocked anyone." /> : null}
        {[...blocked].map((u) => (
          <Row key={u} title={book?.contacts[u] ? authorName(account, book, u).name : 'Someone you blocked'}>
            <Pressable
              accessibilityRole="button"
              onPress={() => unblockUser(u).catch((e) => setError(describeError(e)))}
              className="rounded-full border border-border px-4 py-1.5 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
              <Text className="text-sm font-bold text-ink dark:text-ink-dark">Unblock</Text>
            </Pressable>
          </Row>
        ))}
      </Section>

      <Section title="Your data">
        <Row title="Export my data" subtitle="Your profile, people, posts (with photos) and chats, decrypted on this phone and saved as a file in a folder you pick. Nothing is sent to Circlo." />
        <View className="px-4 pb-4">
          <Button label={exporting ?? 'Export'} variant="outline" loading={!!exporting} onPress={runExport} />
        </View>
      </Section>

      <Section title="Delete account">
        <Row subtitle={`Deletes everything you have on Circlo: posts, photos, replies, likes, people, chats and keys. Type your handle (${account.handle}) to confirm.`} />
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

      <Section title="About Circlo">
        <LinkRow title="Terms of Use" url={LINKS.terms} />
        <LinkRow title="Privacy Policy" url={LINKS.privacy} />
        <LinkRow title="Child safety standards" url={LINKS.childSafety} />
        <LinkRow title="Help and support" url={LINKS.support} />
      </Section>
      <View className="px-4">
        <ErrorText>{error}</ErrorText>
      </View>
    </ScrollView>
  );
}

const PUSH_NOTE = 'They only say there’s something new, never who or what.';

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

/** A row that opens one of Circlo's web pages in the browser. */
function LinkRow({ title, url }: { title: string; url: string }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="link" onPress={() => openLink(url)} className="flex-row items-center gap-4 px-4 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
      <Text className="flex-1 text-[15px] font-semibold text-ink dark:text-ink-dark">{title}</Text>
      <Icon name="open-outline" size={18} color={palette.muted} />
    </Pressable>
  );
}
