import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Row, Section } from '@/components/settings-ui';
import { Text } from '@/components/ui/text';
import { Toggle } from '@/components/ui/toggle';
import { describeError } from '@/lib/account';
import { refreshBlocked, unblockUser, useBlockedPeople } from '@/lib/blocks';
import { useIntegrityWarning } from '@/lib/device-integrity';
import { refreshMe, setShowInCircles, useMe } from '@/lib/me';

const SHOW_TITLE = 'Show me to others in the same circles';

/**
 * Privacy and safety: who can add me, whether people in the same circles of a friend see me (owner decision
 * 2026-11-20), this device's security warning, and the people I've blocked.
 */
export default function PrivacySettingsScreen() {
  const integrity = useIntegrityWarning();
  const blocked = useBlockedPeople();
  const me = useMe();
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      refreshBlocked().catch((e) => setError(describeError(e)));
      refreshMe().catch(() => {});
    }, []),
  );

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="pb-10">
      <Section title="Privacy">
        <Row
          title="No one can search for you"
          subtitle="People connect with your invite link or QR code, or from a friend’s profile when that friend has put you both in the same circle."
        />
        <Row
          title={SHOW_TITLE}
          subtitle="When a friend puts you in a circle with other people, they see you on that friend’s profile and can ask to connect. They never see which circle. Turn this off to stay hidden.">
          {me ? (
            <Toggle
              accessibilityLabel={SHOW_TITLE}
              value={me.showInCircles}
              onValueChange={(on) => {
                setError(undefined);
                setShowInCircles(on).catch((e) => setError(describeError(e)));
              }}
            />
          ) : null}
        </Row>
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
      <View className="px-4">
        <ErrorText>{error}</ErrorText>
      </View>
    </ScrollView>
  );
}
