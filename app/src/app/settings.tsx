import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { Icon } from '@/components/ui/icon';
import { Toggle } from '@/components/ui/toggle';
import { describeError } from '@/lib/account';
import { refreshBlocked, unblockUser, useBlockedPeople } from '@/lib/blocks';
import { LINKS, openLink } from '@/lib/links';
import { useIntegrityWarning } from '@/lib/device-integrity';
import { CHAT_ENABLED } from '@/lib/features';
import { backgroundChecksOn, disableBackgroundChecks, enableBackgroundChecks, notificationPermission, usesPush } from '@/lib/background-check';
import { refreshMe, setEmailNotifications, useMe } from '@/lib/me';
import { deleteAccount, exportMyData } from '@/lib/safety';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';
import { Text, TextInput } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';

/** Settings: notifications, password, privacy, blocked people, export my data, delete my account, and Circlo's terms, privacy and support. */
export default function SettingsScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const palette = usePalette();
  const integrity = useIntegrityWarning();
  const [error, setError] = useState<string>();
  const blocked = useBlockedPeople();
  const me = useMe();
  const [exporting, setExporting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Background checks: on, off, or off because notifications are blocked in the phone's settings.
  const [checks, setChecks] = useState<'on' | 'off' | 'blocked' | null>(null);
  const loadChecks = useCallback(async () => {
    if (await backgroundChecksOn()) return setChecks('on');
    setChecks((await notificationPermission()) === 'blocked' ? 'blocked' : 'off');
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshBlocked().catch((e) => setError(describeError(e)));
      loadChecks().catch(() => {});
      refreshMe().catch(() => {});
    }, [loadChecks]),
  );

  if (!account) return null;

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
      <Section title="Notifications">
        {/* Browsers get no background checks: the web app's Notifications tab updates while it's open. */}
        {Platform.OS !== 'web' ? (
        <Row
          title={CHECKS_TITLE}
          subtitle={checks === 'blocked' ? `Notifications are blocked in your phone’s settings. ${CHECKS_NOTE}` : CHECKS_NOTE}>
          {checks === null ? null : (
            <Toggle
              accessibilityLabel={CHECKS_TITLE}
              value={checks === 'on'}
              onValueChange={async (on) => {
                setError(undefined);
                try {
                  if (on) await enableBackgroundChecks();
                  else await disableBackgroundChecks();
                } catch (e) {
                  setError(describeError(e));
                }
                await loadChecks();
              }}
            />
          )}
        </Row>
        ) : null}
        <Row title={EMAIL_TITLE} subtitle={Platform.OS === 'web' ? EMAIL_NOTE_WEB : EMAIL_NOTE_APP}>
          {me ? (
            <Toggle
              accessibilityLabel={EMAIL_TITLE}
              value={me.emailNotifications}
              onValueChange={async (on) => {
                setError(undefined);
                try {
                  await setEmailNotifications(on);
                } catch (e) {
                  setError(describeError(e));
                }
              }}
            />
          ) : null}
        </Row>
        <Row title="Security emails" subtitle={SECURITY_NOTE} />
      </Section>

      <Section title="Password">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/change-password')}
          className="flex-row items-center gap-4 px-4 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
          <View className="flex-1 gap-0.5">
            <Text className="text-[15px] font-semibold text-ink dark:text-ink-dark">Change password</Text>
            <Text className="text-[13px] leading-[18px] text-muted dark:text-muted-dark">
              Signs out every other device. After 3 wrong passwords, login locks for a while; resetting your password by email always works.
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color={palette.muted} />
        </Pressable>
      </Section>

      <Section title="Privacy">
        <Row title="Only people you invite can add you" subtitle="No one can search for you. People connect by scanning your QR code or opening your invite link." />
        {integrity.message ? <Row title="Device security" subtitle={integrity.message} danger /> : null}
      </Section>

      <Section title="Blocked people">
        {blocked.length === 0 ? <Row subtitle="You haven’t blocked anyone." /> : null}
        {blocked.map((p) => (
          <Row key={p.userId} title={p.name || 'Someone you blocked'} subtitle={p.handle ? `@${p.handle}` : undefined}>
            <Pressable
              accessibilityRole="button"
              onPress={() => unblockUser(p.userId).catch((e) => setError(describeError(e)))}
              className="rounded-full border border-border px-4 py-1.5 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
              <Text className="text-sm font-bold text-ink dark:text-ink-dark">Unblock</Text>
            </Pressable>
          </Row>
        ))}
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

const CHECKS_TITLE = 'A daily notification';
const CHECKS_NOTE = usesPush
  ? 'Once a day, around 6pm, and only on days something happened: “You have a few new things waiting.” It never says who, what or how many. Turn it off and nothing is sent, not even an email.'
  : 'Your phone asks Circlo now and then, and at most once a day says there are new things waiting. Nothing goes through Apple or Google. Turn it off and nothing is sent, not even an email.';

const EMAIL_TITLE = 'A daily email when I’m not using the app';
const EMAIL_WHAT = CHAT_ENABLED ? 'new replies, messages, friends or requests' : 'new replies, friends or requests';
const EMAIL_NOTE_WEB = `Without the Circlo app on a phone, we email you once a day, around 6pm, on days with ${EMAIL_WHAT}. With the app, you’re told on your phone instead and get no emails.`;
const SECURITY_NOTE = 'A new sign-in, a password change or a device signed out is always emailed straight away, whatever you choose here.';
const EMAIL_NOTE_APP = `Only while you’re not signed in to the Circlo app on a phone. While you are, you’re told here instead and get no emails.`;

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
