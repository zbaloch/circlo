import { usePreventScreenCapture } from 'expo-screen-capture';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, ErrorText, TextField } from '@/components/form';
import { PhraseWords } from '@/components/phrase-words';
import { Text } from '@/components/ui/text';
import {
  addPasskeyMethod,
  addPhraseMethod,
  describeError,
  ensurePasskeyWorksHere,
  listRecoveryMethods,
  removeRecoveryMethods,
  type RecoveryMethodInfo,
} from '@/lib/account';
import { BIOMETRIC, createRecoveryPasskey, isCancelled, PasskeyUnavailableError, passkeyPrf, passkeySupported } from '@/lib/passkey';
import { useSession } from '@/lib/session';

type Removing = { kind: 'passkey' | 'phrase'; ids: string[] } | null;

/**
 * Settings → Account recovery (docs/PASSKEY_RECOVERY.md): how to get back in without the password. Face ID (a passkey)
 * and/or a 12-word phrase. Adding needs only this session; removing asks for the password, and the last method stays.
 */
export default function AccountRecoveryScreen() {
  // A new phrase is shown here once: keep it out of screenshots and the app switcher.
  usePreventScreenCapture('account-recovery');
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const [methods, setMethods] = useState<RecoveryMethodInfo[] | null>(null);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<string[] | null>(null);
  const [removing, setRemoving] = useState<Removing>(null);
  const [password, setPassword] = useState('');

  const load = useCallback(() => {
    listRecoveryMethods().then(setMethods, (e) => setError(describeError(e)));
  }, []);
  useFocusEffect(
    useCallback(() => {
      setWords(null);
      setRemoving(null);
      setNote(undefined);
      load();
    }, [load]),
  );

  if (!account) return null;
  const passkeys = (methods ?? []).filter((m) => m.kind === 'passkey');
  const phrases = (methods ?? []).filter((m) => m.kind === 'phrase');
  const total = methods?.length ?? 0;

  const run = async (task: () => Promise<void>) => {
    setError(undefined);
    setNote(undefined);
    setBusy(true);
    try {
      await task();
      load();
    } catch (e) {
      if (!isCancelled(e)) {
        setError(
          e instanceof PasskeyUnavailableError
            ? 'Your password manager can’t be used for recovery. Use a recovery phrase instead.'
            : (e as { code?: string })?.code === 'last_recovery_method'
              ? 'Keep at least one way back in: add the other method first.'
              : describeError(e),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const turnOnPasskey = () => run(async () => addPasskeyMethod(account, await createRecoveryPasskey(account.handle)));
  const checkPasskey = () =>
    run(async () => {
      const added = await ensurePasskeyWorksHere(account, await passkeyPrf());
      setNote(added ? `${BIOMETRIC} recovery is now set up for this phone too.` : `${BIOMETRIC} recovery works on this phone.`);
    });
  const newPhrase = () => run(async () => setWords(await addPhraseMethod(account)));
  const confirmRemove = () =>
    run(async () => {
      if (!removing) return;
      await removeRecoveryMethods(account, removing.ids, password);
      setRemoving(null);
      setPassword('');
    });

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="gap-6 p-5 pb-10" keyboardShouldPersistTaps="handled">
      <Text className="text-base text-muted dark:text-muted-dark">
        If you forget your password, these get you back in. Circlo can’t reset it for you: your posts are end-to-end
        encrypted.
      </Text>

      <View className="gap-2">
        <Text className="text-lg font-bold text-ink dark:text-ink-dark">{`${BIOMETRIC} (passkey)`}</Text>
        {methods === null ? null : passkeys.length ? (
          <>
            <Text className="text-sm text-muted dark:text-muted-dark">On. The passkey is in your password manager.</Text>
            <Button variant="outline" label="Check on this phone" onPress={checkPasskey} disabled={busy} />
            <Button variant="outline" label={`Turn off ${BIOMETRIC} recovery`} onPress={() => setRemoving({ kind: 'passkey', ids: passkeys.map((m) => m.id) })} disabled={busy || total <= passkeys.length} />
          </>
        ) : passkeySupported() ? (
          <>
            <Text className="text-sm text-muted dark:text-muted-dark">Off. Turn it on to get back in with {BIOMETRIC}.</Text>
            <Button label={`Turn on ${BIOMETRIC} recovery`} onPress={turnOnPasskey} loading={busy} />
          </>
        ) : (
          <Text className="text-sm text-muted dark:text-muted-dark">Not available on this phone.</Text>
        )}
      </View>

      <View className="gap-2">
        <Text className="text-lg font-bold text-ink dark:text-ink-dark">Recovery phrase</Text>
        {words ? (
          <>
            <Text className="text-sm text-muted dark:text-muted-dark">
              Save these 12 words now, in your password manager or on paper. They won’t be shown again.
            </Text>
            <PhraseWords words={words} />
            <Button label="I’ve saved it" onPress={() => setWords(null)} />
          </>
        ) : methods === null ? null : phrases.length ? (
          <>
            <Text className="text-sm text-muted dark:text-muted-dark">On. Keep it somewhere safe.</Text>
            <Button variant="outline" label="Remove recovery phrase" onPress={() => setRemoving({ kind: 'phrase', ids: phrases.map((m) => m.id) })} disabled={busy || total <= phrases.length} />
          </>
        ) : (
          <>
            <Text className="text-sm text-muted dark:text-muted-dark">
              Optional: 12 words to write down, for extra safety or if you switch between iPhone and Android.
            </Text>
            <Button variant="outline" label="Create a recovery phrase" onPress={newPhrase} loading={busy} />
          </>
        )}
      </View>

      {removing ? (
        <View className="gap-2">
          <Text className="text-base font-semibold text-ink dark:text-ink-dark">
            {removing.kind === 'passkey' ? `Turn off ${BIOMETRIC} recovery` : 'Remove the recovery phrase'}: enter your password
          </Text>
          <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} textContentType="password" />
          <Button variant="danger" label="Confirm" onPress={confirmRemove} loading={busy} disabled={!password} />
          <Button variant="outline" label="Cancel" onPress={() => setRemoving(null)} disabled={busy} />
        </View>
      ) : null}

      {note ? <Text className="text-base text-ink dark:text-ink-dark">{note}</Text> : null}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
