import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Row, Section } from '@/components/settings-ui';
import { Toggle } from '@/components/ui/toggle';
import { describeError } from '@/lib/account';
import { backgroundChecksOn, disableBackgroundChecks, enableBackgroundChecks, notificationPermission, usesPush } from '@/lib/background-check';
import { CHAT_ENABLED } from '@/lib/features';
import { refreshMe, setEmailNotifications, useMe } from '@/lib/me';

/** Notifications: the daily phone notification, the daily email, and the security emails that always go out. */
export default function NotificationSettingsScreen() {
  const [error, setError] = useState<string>();
  const me = useMe();
  // Background checks: on, off, or off because notifications are blocked in the phone's settings.
  const [checks, setChecks] = useState<'on' | 'off' | 'blocked' | null>(null);
  const loadChecks = useCallback(async () => {
    if (await backgroundChecksOn()) return setChecks('on');
    setChecks((await notificationPermission()) === 'blocked' ? 'blocked' : 'off');
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadChecks().catch(() => {});
      refreshMe().catch(() => {});
    }, [loadChecks]),
  );

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="pb-10">
      <Section>
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
const SECURITY_NOTE = 'A new sign-in, a password change, or another device signed out from Devices is always emailed straight away, whatever you choose here.';
const EMAIL_NOTE_APP = `Only while you’re not signed in to the Circlo app on a phone. While you are, you’re told here instead and get no emails.`;
