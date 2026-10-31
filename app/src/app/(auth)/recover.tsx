import { usePreventScreenCapture } from 'expo-screen-capture';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { PasswordStrength } from '@/components/password-strength';
import { Text } from '@/components/ui/text';
import { describeError, recover, recoverWithPasskey } from '@/lib/account';
import { BIOMETRIC, isCancelled, PasskeyUnavailableError, passkeyPrf, passkeySupported } from '@/lib/passkey';
import { checkPassword } from '@/lib/password-strength';
import { useSession } from '@/lib/session';

/** Forgot the password: get back in with Face ID (the passkey) or the recovery phrase, and choose a new password. */
export default function RecoverScreen() {
  // Recovery words must never end up in screenshots, recordings or the recent-apps preview.
  usePreventScreenCapture('recover');
  const { signIn } = useSession();
  const [usePhrase, setUsePhrase] = useState(!passkeySupported());
  const [handle, setHandle] = useState('');
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const strength = checkPassword(password, handle);

  const submit = async () => {
    setError(undefined);
    if (usePhrase && ![12, 24].includes(phrase.trim().split(/\s+/).length)) {
      setError('Enter all the words of your recovery phrase (12 or 24), separated by spaces.');
      return;
    }
    if (!strength.ok) {
      setError(strength.problem ?? 'Choose a stronger password.');
      return;
    }
    if (password !== confirm) {
      setError('The passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      if (usePhrase) {
        signIn(await recover(handle, phrase, password));
      } else {
        signIn(await recoverWithPasskey(handle, await passkeyPrf(), password));
      }
    } catch (e) {
      if (isCancelled(e)) return;
      const tag = (e as { tag?: string })?.tag;
      const code = (e as { code?: string })?.code;
      setError(
        e instanceof PasskeyUnavailableError
          ? 'That passkey can’t be used for recovery. Use your recovery phrase instead.'
          : tag === 'DecryptionFailed' || code === 'unauthorized'
            ? usePhrase
              ? 'That recovery phrase doesn’t match this handle.'
              : `That ${BIOMETRIC} passkey isn’t set up for this handle. Use your recovery phrase instead.`
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
      <Title
        subtitle={
          usePhrase
            ? 'Your recovery phrase unlocks your encrypted backup. Then choose a new password; other devices will be logged out.'
            : `${BIOMETRIC} unlocks your encrypted backup with the passkey you saved. Then choose a new password; other devices will be logged out.`
        }>
        Recover your account
      </Title>
      <TextField label="Handle" value={handle} onChangeText={setHandle} />
      {usePhrase ? (
        <TextField label="Recovery phrase (12 or 24 words)" value={phrase} onChangeText={setPhrase} multiline numberOfLines={4} />
      ) : null}
      <TextField label="New password" secureTextEntry value={password} onChangeText={setPassword} textContentType="newPassword" />
      <PasswordStrength check={strength} empty={!password} />
      <TextField label="Confirm new password" secureTextEntry value={confirm} onChangeText={setConfirm} textContentType="newPassword" />
      <ErrorText>{error}</ErrorText>
      <Button size="lg" label={usePhrase ? 'Recover' : `Continue with ${BIOMETRIC}`} onPress={submit} loading={busy} />
      {passkeySupported() ? (
        <Pressable accessibilityRole="link" onPress={() => setUsePhrase(!usePhrase)} className="items-center py-2">
          <Text className="font-semibold text-primary dark:text-primary-dark">
            {usePhrase ? `Use ${BIOMETRIC} instead` : 'Use my recovery phrase instead'}
          </Text>
        </Pressable>
      ) : null}
    </AuthScreen>
  );
}
