import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { describeError } from '@/lib/account';
import { confirmationCodeFor, linkFromParams, parseLinkQr, sendLink, takeScannedLink } from '@/lib/device-link';
import { useSession } from '@/lib/session';

/** Signed-in device: check the code matches the new phone's screen, then hand off this account's keys to it. */
export default function LinkConfirmScreen() {
  const { id, k } = useLocalSearchParams<{ id?: string; k?: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  // The screen stays mounted in the drawer: pick up a fresh scan (or deep-link params) each time it's shown.
  useFocusEffect(
    useCallback(() => {
      setQr(takeScannedLink() ?? linkFromParams(id, k));
      setDone(false);
      setError(undefined);
    }, [id, k]),
  );
  const parsed = qr ? parseLinkQr(qr) : null;
  if (!account || !parsed) return null;
  const code = confirmationCodeFor(parsed.publicKey);

  return (
    <View className="flex-1 gap-5 bg-surface p-6 dark:bg-surface-dark">
      {done ? (
        <>
          <Text className="text-2xl font-bold text-ink dark:text-ink-dark">Sent</Text>
          <Text className="text-base text-ink dark:text-ink-dark">Your new phone will finish setting up in a moment.</Text>
          <Button label="Done" onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Text className="text-2xl font-bold text-ink dark:text-ink-dark">Link this phone?</Text>
          <Text className="text-base text-ink dark:text-ink-dark">Check that your new phone shows this code:</Text>
          <Text
            accessibilityLabel={`Code ${code.split('').join(' ')}`}
            className="text-center font-mono text-5xl font-bold tracking-widest text-primary dark:text-primary-dark">
            {code.slice(0, 3)} {code.slice(3)}
          </Text>
          <Text className="text-sm text-muted dark:text-muted-dark">
            Only continue if the codes match and the phone is yours. It will get your account keys and can read everything you can.
          </Text>
          <ErrorText>{error}</ErrorText>
          <Button
            label="Codes match, link it"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await sendLink(account, parsed.linkId, parsed.publicKey);
                setDone(true);
              } catch (e) {
                setError(describeError(e));
              } finally {
                setBusy(false);
              }
            }}
          />
          <Button label="Cancel" variant="outline" onPress={() => router.back()} />
        </>
      )}
    </View>
  );
}
