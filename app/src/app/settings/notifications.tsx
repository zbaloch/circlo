import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Row, Section } from '@/components/settings-ui';
import { Toggle } from '@/components/ui/toggle';
import { describeError } from '@/lib/account';
import { backgroundChecksOn, disableBackgroundChecks, enableBackgroundChecks, notificationPermission, usesPush } from '@/lib/background-check';
import { CHAT_ENABLED } from '@/lib/features';
import { type NotificationSettings, refreshMe, setNotificationSettings, useMe } from '@/lib/me';
import { peopleRemindersOn, schedulePeopleReminders, setPeopleRemindersOn } from '@/lib/people-reminders';
import { getPeople } from '@/lib/people-store';

type Kind = keyof Omit<NotificationSettings, 'email'>;

/**
 * Notifications, X-style (owner decision 2026-11-18): this phone's push on or off, then each kind as it happens
 * (messages, replies, friend requests and new friends), the 6pm reminder, the daily email, and the security alerts
 * that always go out. The kinds are account settings, so they apply to all my phones.
 */
export default function NotificationSettingsScreen() {
  const [error, setError] = useState<string>();
  const me = useMe();
  // This phone: on, off, or off because notifications are blocked in the phone's settings.
  const [phone, setPhone] = useState<'on' | 'off' | 'blocked' | null>(null);
  // People's birthday and catch-up reminders, scheduled on this phone (its own switch, kept on the phone).
  const [reminders, setReminders] = useState<boolean | null>(null);
  const loadPhone = useCallback(async () => {
    setReminders(await peopleRemindersOn());
    if (await backgroundChecksOn()) return setPhone('on');
    setPhone((await notificationPermission()) === 'blocked' ? 'blocked' : 'off');
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPhone().catch(() => {});
      refreshMe().catch(() => {});
    }, [loadPhone]),
  );

  const change = async (c: NotificationSettings) => {
    setError(undefined);
    try {
      await setNotificationSettings(c);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const kindRow = (kind: Kind, title: string, subtitle: string) => (
    <Row key={kind} title={title} subtitle={subtitle}>
      {me ? <Toggle accessibilityLabel={title} value={me[kind]} onValueChange={(on) => change({ [kind]: on })} /> : null}
    </Row>
  );

  // Browsers get no push: the web app's Notifications tab updates while it's open.
  const native = Platform.OS !== 'web';
  const kinds = native && usesPush && phone === 'on';

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="pb-10">
      {native ? (
        <Section title="On this phone">
          <Row title={PHONE_TITLE} subtitle={phone === 'blocked' ? `Notifications are blocked in your phone’s settings. ${PHONE_NOTE}` : PHONE_NOTE}>
            {phone === null ? null : (
              <Toggle
                accessibilityLabel={PHONE_TITLE}
                value={phone === 'on'}
                onValueChange={async (on) => {
                  setError(undefined);
                  try {
                    if (on) await enableBackgroundChecks();
                    else await disableBackgroundChecks();
                    // With permission now given, People's reminders can be scheduled.
                    if (on && getPeople().loaded) await schedulePeopleReminders(getPeople().people);
                  } catch (e) {
                    setError(describeError(e));
                  }
                  await loadPhone();
                }}
              />
            )}
          </Row>
        </Section>
      ) : null}
      {kinds ? (
        <>
          <Section title="As it happens">
            {CHAT_ENABLED ? kindRow('pushMessages', 'Messages', 'New messages in your chats.') : null}
            {kindRow('pushReplies', 'Replies', 'Replies to your posts and to your replies.')}
            {kindRow('pushFriends', 'Friend requests and new friends', 'Someone asks to connect, accepts your request or joins with your link.')}
          </Section>
          <Section title="Once a day">{kindRow('pushDaily', 'Daily reminder', DAILY_NOTE)}</Section>
        </>
      ) : null}
      {native && phone === 'on' && reminders !== null ? (
        <Section title="People">
          <Row title="Birthdays and catch-ups" subtitle="At 9 in the morning on the day, and when it’s time to catch up with someone. Set on this phone; Circlo’s server doesn’t send them.">
            <Toggle
              accessibilityLabel="Birthdays and catch-ups"
              value={reminders}
              onValueChange={async (on) => {
                setReminders(on);
                await setPeopleRemindersOn(on, getPeople().people).catch(() => undefined);
              }}
            />
          </Row>
        </Section>
      ) : null}
      <Section title="Email">
        <Row title={EMAIL_TITLE} subtitle={EMAIL_NOTE}>
          {me ? <Toggle accessibilityLabel={EMAIL_TITLE} value={me.emailNotifications} onValueChange={(on) => change({ email: on })} /> : null}
        </Row>
      </Section>
      <Section title="Always on">
        <Row title="Security alerts" subtitle={SECURITY_NOTE} />
      </Section>
      <View className="px-4">
        <ErrorText>{error}</ErrorText>
      </View>
    </ScrollView>
  );
}

const PHONE_TITLE = usesPush ? 'Push notifications' : 'A daily notification';
const PHONE_NOTE = usesPush
  ? 'Lets Circlo notify this phone. Notifications never say who, what or how many. Turn it off and this phone isn’t told anything; the email below is separate.'
  : 'Your phone asks Circlo now and then, and at most once a day says there are new things waiting. Nothing goes through Apple or Google. Turn it off and your phone isn’t told; the daily email below is separate.';
const DAILY_NOTE = 'Around 6pm, on days your circles shared something or anything else is new: a calm note to come and catch up.';

const EMAIL_TITLE = 'Daily email';
const EMAIL_WHAT = CHAT_ENABLED ? 'new posts from your circles, replies, messages, friends or requests' : 'new posts from your circles, replies, friends or requests';
const EMAIL_NOTE = `Around 6pm, on days with ${EMAIL_WHAT}: what kind of things are waiting, never who or what. It’s separate from notifications on your phone.`;
const SECURITY_NOTE = usesPush
  ? 'A new sign-in, a password change, or another device signed out from Devices is always emailed straight away, and your phones with notifications on are told too, whatever you choose here.'
  : 'A new sign-in, a password change, or another device signed out from Devices is always emailed straight away, whatever you choose here.';
