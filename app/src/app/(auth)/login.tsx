import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { describeError, login } from '@/lib/account';
import { useSession } from '@/lib/session';

/** Log in on this device: the encrypted key backup is downloaded and decrypted here. */
export default function LoginScreen() {
  const { signIn } = useSession();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(undefined);
    setBusy(true);
    try {
      signIn(await login(handle, password));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <Title subtitle="Your keys are restored from your encrypted backup. Only your password can unlock it.">Log in</Title>
      <TextField label="Handle" value={handle} onChangeText={setHandle} textContentType="username" />
      <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} textContentType="password" />
      <ErrorText>{error}</ErrorText>
      <Button label="Log in" onPress={submit} loading={busy} disabled={!handle || !password} />
      <Pressable accessibilityRole="link" onPress={() => router.push('/recover')} className="items-center py-2">
        <Text className="font-semibold text-primary dark:text-primary-dark">Forgot password? Use your recovery phrase</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => router.push('/link')} className="items-center py-2">
        <Text className="font-semibold text-primary dark:text-primary-dark">Link from another device</Text>
      </Pressable>
    </AuthScreen>
  );
}
