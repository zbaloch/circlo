import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AuthScreen } from '@/components/auth-screen';
import { ErrorText, Title } from '@/components/form';
import { describeError } from '@/lib/account';
import { pickUpLink, startLink } from '@/lib/device-link';
import { useSession } from '@/lib/session';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';

/**
 * New device: show a one-time code for the signed-in phone to scan (Devices → Link a new device). The account keys
 * arrive sealed to this screen's key; the server only relays ciphertext.
 */
export default function LinkScreen() {
  const { signIn } = useSession();
  const link = useMemo(() => startLink(), []);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const account = await pickUpLink(link);
        if (account && !stopped) {
          stopped = true;
          clearInterval(timer);
          signIn(account);
        }
      } catch (e) {
        setError(describeError(e));
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [link, signIn]);

  return (
    <AuthScreen>
      <Title subtitle="On your signed-in phone, open Devices → Link a new device and scan this code.">Link from another device</Title>
      <View className="items-center gap-5 py-4">
        <View className="rounded-2xl bg-white p-4">
          <QRCode value={link.qr} size={220} />
        </View>
        <Text className="text-base text-ink dark:text-ink-dark">Both phones should show:</Text>
        <Text accessibilityLabel={`Code ${link.code.split('').join(' ')}`} className="font-mono text-4xl font-bold tracking-widest text-primary dark:text-primary-dark">
          {link.code.slice(0, 3)} {link.code.slice(3)}
        </Text>
        <View className="flex-row items-center gap-2">
          <Spinner />
          <Text className="text-muted dark:text-muted-dark">Waiting for your other phone…</Text>
        </View>
        <ErrorText>{error}</ErrorText>
      </View>
    </AuthScreen>
  );
}
