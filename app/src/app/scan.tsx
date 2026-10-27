import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { describeError } from '@/lib/account';
import { parseLinkQr, setScannedLink } from '@/lib/device-link';
import { acceptInvite, getContact, InviteError, safetyNumber, setVerified } from '@/lib/friends';
import { useSession } from '@/lib/session';
import { Text } from '@/components/ui/text';

/** Scans an invite QR, a friend's safety-number QR, or a new device's link code (Devices: Link a new device). */
export default function ScanScreen() {
  const { safetyFor } = useLocalSearchParams<{ safetyFor?: string }>();
  const session = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const handled = useRef(false);
  const account = session.status === 'signedIn' ? session.account : null;

  if (!account) return null;
  if (!permission?.granted) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-surface p-6 dark:bg-surface-dark">
        <Text className="text-center text-ink dark:text-ink-dark">
          Halqo uses the camera only to scan invite and safety-number codes. Nothing is recorded.
        </Text>
        <Button label="Allow camera" onPress={requestPermission} />
      </View>
    );
  }

  const onScan = async (data: string) => {
    if (handled.current) return;
    handled.current = true;
    try {
      if (parseLinkQr(data)) {
        // A new device's link code: confirm the 6-digit code before anything is sent.
        setScannedLink(data);
        router.replace('/link-confirm');
        return;
      }
      if (safetyFor) {
        const contact = await getContact(account, safetyFor);
        const mine = contact && `halqo-safety:${safetyNumber(account, safetyFor, contact).qr}`;
        if (mine && data === mine) {
          await setVerified(account, safetyFor, true);
          setStatus('Safety numbers match. Marked as verified.');
        } else {
          setError('These safety numbers don’t match. Don’t mark this friend as verified.');
        }
      } else {
        await acceptInvite(account, data);
        setStatus('Friend request sent. You’ll see their profile once they accept.');
      }
    } catch (e) {
      setError(e instanceof InviteError ? e.message : describeError(e));
    }
  };

  return (
    <View className="flex-1 bg-black">
      {!status && !error ? (
        <CameraView
          className="flex-1"
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => void onScan(data)}
        />
      ) : (
        <View className="flex-1 items-center justify-center gap-4 bg-surface p-6 dark:bg-surface-dark">
          {status ? <Text className="text-center text-lg text-primary dark:text-primary-dark">{status}</Text> : null}
          <ErrorText>{error}</ErrorText>
          <Button label="Done" onPress={() => router.back()} />
        </View>
      )}
    </View>
  );
}
