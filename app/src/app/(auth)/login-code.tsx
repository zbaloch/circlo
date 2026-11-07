import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { Text } from '@/components/ui/text';
import { describeError, resendLoginCode, verifyLoginCode } from '@/lib/account';
import { useSession } from '@/lib/session';

/**
 * The second step of logging in (owner decision 2026-11-07): the 6-digit code Circlo emailed after the right password.
 * It works only for this attempt (its challenge), for 15 minutes, and finishes signing in this device.
 */
export default function LoginCodeScreen() {
  const { login = '', email = '', challenge = '' } = useLocalSearchParams<{ login: string; email: string; challenge: string }>();
  const { signIn } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(undefined);
    setBusy(true);
    try {
      signIn(await verifyLoginCode(login, challenge, code));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(undefined);
    try {
      await resendLoginCode(login, challenge);
      setNotice('We sent a new code. It can take a minute to arrive; check your spam folder too.');
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <AuthScreen>
      <Title subtitle={`We sent a 6-digit code to ${email}. Enter it to log in. It keeps your account safe even if someone learns your password.`}>
        Check your email
      </Title>
      <TextField
        label="Code"
        placeholder="123456"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
      />
      <ErrorText>{error}</ErrorText>
      {notice ? <Text className="text-base text-muted dark:text-muted-dark">{notice}</Text> : null}
      <Button size="lg" label="Log in" onPress={submit} loading={busy} disabled={code.length !== 6} />
      <Pressable accessibilityRole="button" onPress={resend} className="items-center py-2">
        <Text className="font-semibold text-primary dark:text-primary-dark">Send a new code</Text>
      </Pressable>
    </AuthScreen>
  );
}
