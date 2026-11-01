import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { CirclePickerSheet, circlesLine } from '@/components/circle-choice';
import { Button, ErrorText } from '@/components/form';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { acceptInvite, InviteError } from '@/lib/friends';
import { useSession } from '@/lib/session';
import { Text } from '@/components/ui/text';

/** Scans someone's invite QR code. */
export default function ScanScreen() {
  const session = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  // A scanned invite waits here while I choose the person's circles (none: Everyone only).
  const [pending, setPending] = useState<{ data: string; book: AddressBook }>();
  const chosen = useRef(false);
  const handled = useRef(false);
  const account = session.status === 'signedIn' ? session.account : null;

  if (!account) return null;
  if (!permission?.granted) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-surface p-6 dark:bg-surface-dark">
        <Text className="text-center text-ink dark:text-ink-dark">
          Circlo uses the camera only to scan invite codes. Nothing is recorded.
        </Text>
        <Button label="Allow camera" onPress={requestPermission} />
      </View>
    );
  }

  const onScan = async (data: string) => {
    if (handled.current) return;
    handled.current = true;
    try {
      setPending({ data, book: await loadAddressBook(account) });
    } catch (e) {
      setError(e instanceof InviteError ? e.message : describeError(e));
    }
  };

  const sendInvite = async (data: string, book: AddressBook, circles: number[]) => {
    try {
      await acceptInvite(account, data, circles);
      setStatus(`Request sent${circles.length ? `, in ${circlesLine(book, circles)}` : ''}. You’ll see their profile once they accept.`);
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
      {pending ? (
        <CirclePickerSheet
          visible
          book={pending.book}
          selected={[]}
          title="Add to circles"
          confirmLabel="Send request"
          onDone={(ids) => {
            chosen.current = true;
            void sendInvite(pending.data, pending.book, ids);
          }}
          onClose={() => {
            setPending(undefined);
            // Dismissed without sending: go back to scanning.
            if (!chosen.current) handled.current = false;
            chosen.current = false;
          }}
        />
      ) : null}
    </View>
  );
}
