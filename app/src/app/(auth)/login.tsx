import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { Text } from '@/components/ui/text';
import { ApiError } from '@/api/client';
import { describeError, login } from '@/lib/account';
import { useSession } from '@/lib/session';

/** Log in with a username or email and password. */
export default function LoginScreen() {
  const { signIn } = useSession();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(undefined);
    setBusy(true);
    try {
      signIn(await login(name, password));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'email_not_verified' && e.details.email) {
        // A signup that was never finished: a fresh code is on its way.
        router.push({ pathname: '/verify-email', params: { email: e.details.email } });
      } else {
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <Title>Log in</Title>
      <TextField label="Username or email" value={name} onChangeText={setName} textContentType="username" autoComplete="username" keyboardType="email-address" />
      <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} textContentType="password" autoComplete="current-password" onSubmitEditing={submit} />
      <ErrorText>{error}</ErrorText>
      <Button size="lg" label="Log in" onPress={submit} loading={busy} disabled={!name || !password} />
      <Pressable accessibilityRole="link" onPress={() => router.push('/forgot-password')} className="items-center py-2">
        <Text className="font-semibold text-primary dark:text-primary-dark">Forgot your password?</Text>
      </Pressable>
    </AuthScreen>
  );
}
