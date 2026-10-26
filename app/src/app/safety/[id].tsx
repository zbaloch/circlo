import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/components/form';
import type { Contact } from '@/lib/addressbook';
import { acceptNewIdentity, getContact, safetyNumber, setVerified } from '@/lib/friends';
import { useSession } from '@/lib/session';

/**
 * Safety number (CRYPTO.md section 12): the same 60 digits on both phones if neither side's keys were swapped.
 * Compare by reading them aloud or by scanning each other's code.
 */
export default function SafetyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const [contact, setContact] = useState<Contact>();
  const account = session.status === 'signedIn' ? session.account : null;

  const load = useCallback(() => {
    if (account && id) void getContact(account, id).then(setContact);
  }, [account, id]);
  useFocusEffect(load);

  if (!account || !contact) return null;
  // When keys changed, show the number for the NEW keys: that's what must be checked before trusting them.
  const shown = contact.identityChanged ? { ...contact, ed25519: contact.identityChanged.ed25519, x25519: contact.identityChanged.x25519 } : contact;
  const sn = safetyNumber(account, id!, shown);

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="items-center gap-5 p-6">
      <Text className="text-center text-muted dark:text-muted-dark">
        {contact.identityChanged
          ? 'Their keys changed. Check this new number with them in person or on a call you trust.'
          : 'If this number matches the one on your friend’s phone, nobody is intercepting your connection.'}
      </Text>
      <View className="flex-row flex-wrap justify-center gap-3" accessibilityLabel={`Safety number ${sn.groups.join(' ')}`}>
        {sn.groups.map((g, i) => (
          <Text key={i} className="w-[28%] text-center font-mono text-xl text-ink dark:text-ink-dark">
            {g}
          </Text>
        ))}
      </View>
      <View className="rounded-xl bg-white p-3">
        <QRCode value={`halqo-safety:${sn.qr}`} size={180} />
      </View>
      <View className="w-full gap-3">
        <Button label="Scan their code" variant="outline" onPress={() => router.push({ pathname: '/scan', params: { safetyFor: id } })} />
        {contact.identityChanged ? (
          <Button
            label="I checked it: trust the new keys"
            onPress={async () => {
              await acceptNewIdentity(account, id!);
              load();
            }}
          />
        ) : (
          <Button
            label={contact.verified ? 'Mark as not verified' : 'Mark as verified'}
            variant={contact.verified ? 'outline' : 'primary'}
            onPress={async () => {
              await setVerified(account, id!, !contact.verified);
              load();
            }}
          />
        )}
      </View>
    </ScrollView>
  );
}
