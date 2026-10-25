import { useState } from 'react';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { describeError, MIN_PASSWORD, recover } from '@/lib/account';
import { useSession } from '@/lib/session';

/** Recover with the 24-word phrase and choose a new password. */
export default function RecoverScreen() {
  const { signIn } = useSession();
  const [handle, setHandle] = useState('');
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(undefined);
    if (phrase.trim().split(/\s+/).length !== 24) {
      setError('Enter all 24 words, separated by spaces.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      signIn(await recover(handle, phrase, password));
    } catch (e) {
      const tag = (e as { tag?: string })?.tag;
      setError(
        tag === 'DecryptionFailed' || (e as { code?: string })?.code === 'unauthorized'
          ? 'That recovery phrase doesn’t match this handle.'
          : tag === 'InvalidInput'
            ? 'That isn’t a valid recovery phrase. Check each word.'
            : describeError(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <Title subtitle="Your recovery phrase unlocks your encrypted backup. Then choose a new password; other devices will be logged out.">
        Recover your account
      </Title>
      <TextField label="Handle" value={handle} onChangeText={setHandle} />
      <TextField label="Recovery phrase (24 words)" value={phrase} onChangeText={setPhrase} multiline numberOfLines={4} />
      <TextField label="New password" secureTextEntry value={password} onChangeText={setPassword} textContentType="newPassword" />
      <TextField label="Confirm new password" secureTextEntry value={confirm} onChangeText={setConfirm} textContentType="newPassword" />
      <ErrorText>{error}</ErrorText>
      <Button label="Recover" onPress={submit} loading={busy} />
    </AuthScreen>
  );
}
