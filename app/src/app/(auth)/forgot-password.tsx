import { useState } from 'react';
import { Pressable } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { PasswordStrength } from '@/components/password-strength';
import { Text } from '@/components/ui/text';
import { describeError, forgotPassword, looksLikeEmail, resetPassword } from '@/lib/account';
import { checkPassword } from '@/lib/password-strength';
import { useSession } from '@/lib/session';

/**
 * Forgot password: Circlo emails a 6-digit code, then a new password is set with it. Every other device is signed out,
 * and any login lock lifts.
 */
export default function ForgotPasswordScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const strength = checkPassword(password);

  const send = async () => {
    setError(undefined);
    if (!looksLikeEmail(email)) return setError('That doesn’t look like an email address.');
    setBusy(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(undefined);
    if (!strength.ok) return setError(strength.problem ?? 'Choose a stronger password.');
    setBusy(true);
    try {
      signIn(await resetPassword(email, code, password));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <AuthScreen>
        <Title subtitle="Enter the email you signed up with. If it has a Circlo account, we’ll send it a code to set a new password.">
          Reset your password
        </Title>
        <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
        <ErrorText>{error}</ErrorText>
        <Button size="lg" label="Send code" onPress={send} loading={busy} disabled={!email} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Title subtitle={`If ${email.trim()} has a Circlo account, a 6-digit code is on its way. It works for 15 minutes.`}>Choose a new password</Title>
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
      <TextField label="New password" secureTextEntry value={password} onChangeText={setPassword} textContentType="newPassword" autoComplete="new-password" />
      <PasswordStrength check={strength} empty={!password} />
      <ErrorText>{error}</ErrorText>
      <Button size="lg" label="Set password and log in" onPress={reset} loading={busy} disabled={code.length !== 6 || !password} />
      <Pressable accessibilityRole="button" onPress={send} className="items-center py-2">
        <Text className="font-semibold text-primary dark:text-primary-dark">Send a new code</Text>
      </Pressable>
    </AuthScreen>
  );
}
