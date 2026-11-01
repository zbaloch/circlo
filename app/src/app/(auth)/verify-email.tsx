import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { Text } from '@/components/ui/text';
import { describeError, resendCode, verifyEmail } from '@/lib/account';
import { useSession } from '@/lib/session';

/** The 6-digit code Circlo emailed: finishes the signup and signs in. */
export default function VerifyEmailScreen() {
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const { signIn } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(undefined);
    setBusy(true);
    try {
      signIn(await verifyEmail(email, code));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(undefined);
    try {
      await resendCode(email);
      setNotice('We sent a new code. It can take a minute to arrive; check your spam folder too.');
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <AuthScreen>
      <Title subtitle={`We sent a 6-digit code to ${email}. Enter it to finish creating your account.`}>Check your email</Title>
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
      <Button size="lg" label="Create account" onPress={submit} loading={busy} disabled={code.length !== 6} />
      <Pressable accessibilityRole="button" onPress={resend} className="items-center py-2">
        <Text className="font-semibold text-primary dark:text-primary-dark">Send a new code</Text>
      </Pressable>
    </AuthScreen>
  );
}
