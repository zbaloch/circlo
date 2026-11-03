import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Row, Section } from '@/components/settings-ui';
import { Text } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { refreshBlocked, unblockUser, useBlockedPeople } from '@/lib/blocks';
import { useIntegrityWarning } from '@/lib/device-integrity';

/** Privacy and safety: who can add me, this device's security warning, and the people I've blocked. */
export default function PrivacySettingsScreen() {
  const integrity = useIntegrityWarning();
  const blocked = useBlockedPeople();
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      refreshBlocked().catch((e) => setError(describeError(e)));
    }, []),
  );

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="pb-10">
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
      <View className="px-4">
        <ErrorText>{error}</ErrorText>
      </View>
    </ScrollView>
  );
}
