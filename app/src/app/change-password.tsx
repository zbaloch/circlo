import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { PasswordStrength } from '@/components/password-strength';
import { changePassword, describeError } from '@/lib/account';
import { showAlert } from '@/lib/dialog';
import { checkPassword } from '@/lib/password-strength';
import { useSession } from '@/lib/session';

/** Change the password: proves the current one on this phone, then signs out every other device. */
export default function ChangePasswordScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const strength = checkPassword(next, account?.handle);

  // The screen stays mounted: never show a password typed on an earlier visit.
  useFocusEffect(
    useCallback(() => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(undefined);
    }, []),
  );

  const submit = async () => {
    if (!account) return;
    setError(undefined);
    if (!strength.ok) return setError(strength.problem ?? 'Choose a stronger password.');
    if (next !== confirm) return setError('The new passwords don’t match.');
    if (next === current) return setError('Choose a password different from your current one.');
    setBusy(true);
    try {
      await changePassword(current, next);
      showAlert('Password changed', 'Every other device has been signed out. Sign in there again with your new password.');
      router.back();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <Title subtitle="Changing it signs out every other device, including anyone else who knew the old one.">
        Change password
      </Title>
      <TextField label="Current password" secureTextEntry value={current} onChangeText={setCurrent} textContentType="password" />
      <TextField label="New password" secureTextEntry value={next} onChangeText={setNext} textContentType="newPassword" />
      <PasswordStrength check={strength} empty={!next} />
      <TextField label="Confirm new password" secureTextEntry value={confirm} onChangeText={setConfirm} textContentType="newPassword" />
      <ErrorText>{error}</ErrorText>
      <Button size="lg" label="Change password" onPress={submit} loading={busy} disabled={!current || !next || !confirm} />
    </AuthScreen>
  );
}
