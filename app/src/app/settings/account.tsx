import { useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { NavRow, Row, Section } from '@/components/settings-ui';
import { TextInput } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { showAlert } from '@/lib/dialog';
import { deleteAccount, exportMyData } from '@/lib/safety';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

/** Your account: change password, export my data, delete my account. */
export default function AccountSettingsScreen() {
  const session = useSession();
  const palette = usePalette();
  const [error, setError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (session.status !== 'signedIn') return null;

  const runExport = async () => {
    setError(undefined);
    try {
      setExporting(true);
      const name = await exportMyData();
      showAlert('Export saved', Platform.OS === 'web' ? `${name} was downloaded. Keep it somewhere safe.` : `${name} is in the folder you chose. Keep it somewhere safe.`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setExporting(false);
    }
  };

  const runDelete = () =>
    showAlert('Delete your account?', 'Your profile, posts, photos, replies, likes, people and chats are deleted from Circlo for good. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete forever',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteAccount(confirm);
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
      <Section title="Password">
        <NavRow
          title="Change password"
          subtitle="Signs out every other device. After 3 wrong passwords, login locks for a while; resetting your password by email always works."
          href="/change-password"
        />
      </Section>

      <Section title="Your data">
        <Row title="Export my data" subtitle="A copy of your profile, circles, people, posts, replies and chats as one file (photos and videos as download links)." />
        <View className="px-4 pb-4">
          <Button label="Export" variant="outline" loading={exporting} onPress={runExport} />
        </View>
      </Section>

      <Section title="Delete account">
        <Row subtitle="Deletes everything you have on Circlo: your profile, posts, photos, replies, likes, people and chats. Enter your password to confirm." />
        <View className="gap-3 px-4 pb-4">
          <TextInput
            accessibilityLabel="Your password, to confirm"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Password"
            placeholderTextColor={palette.muted}
            className="rounded-lg border border-border px-4 py-3 text-[15px] text-ink dark:border-border-dark dark:text-ink-dark"
          />
          <Button label="Delete my account" variant="danger" disabled={!confirm} loading={deleting} onPress={runDelete} />
        </View>
      </Section>
      <View className="px-4">
        <ErrorText>{error}</ErrorText>
      </View>
    </ScrollView>
  );
}
