import { router } from 'expo-router';
import { useState } from 'react';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { describeError, MIN_PASSWORD, normalizeHandle, Signup } from '@/lib/account';
import { setPendingSignup } from '@/lib/signup-store';

export default function SignupScreen() {
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(undefined);
    try {
      normalizeHandle(handle);
    } catch {
      setError('Handles are 3–30 characters: letters, numbers and _.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters. A few random words work well.`);
      return;
    }
    if (password !== confirm) {
      setError('The passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      setPendingSignup(await Signup.start(handle, password));
      router.push('/recovery-phrase');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <Title subtitle="Your handle is what your friends see. No one can search you with it though. There’s no email or phone number, and your password never leaves this phone.">
        Create your account
      </Title>
      <TextField label="Handle" placeholder="e.g. sam_k" value={handle} onChangeText={setHandle} maxLength={30} />
      <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} textContentType="newPassword" />
      <TextField label="Confirm password" secureTextEntry value={confirm} onChangeText={setConfirm} textContentType="newPassword" />
      <ErrorText>{error}</ErrorText>
      <Button size="lg" label="Continue" onPress={submit} loading={busy} />
    </AuthScreen>
  );
}
