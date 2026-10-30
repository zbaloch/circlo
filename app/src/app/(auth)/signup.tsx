import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { PasswordStrength } from '@/components/password-strength';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { describeError, normalizeHandle, Signup } from '@/lib/account';
import { checkPassword } from '@/lib/password-strength';
import { LINKS, openLink } from '@/lib/links';
import { setPendingSignup } from '@/lib/signup-store';
import { usePalette } from '@/theme/use-palette';

export default function SignupScreen() {
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const palette = usePalette();
  const strength = checkPassword(password, handle);

  const submit = async () => {
    setError(undefined);
    try {
      normalizeHandle(handle);
    } catch {
      setError('Handles are 3–30 characters: letters, numbers and _.');
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
      <Title subtitle="Your handle is what your people see. No one can search you with it though. There’s no email or phone number, and your password never leaves this phone.">
        Create your account
      </Title>
      <TextField label="Handle" placeholder="e.g. sam_k" value={handle} onChangeText={setHandle} maxLength={30} />
      <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} textContentType="newPassword" />
      <PasswordStrength check={strength} empty={!password} />
      <TextField label="Confirm password" secureTextEntry value={confirm} onChangeText={setConfirm} textContentType="newPassword" />
      <View className="flex-row items-start gap-3">
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I agree to the Terms of Use and Privacy Policy"
          onPress={() => setAgreed(!agreed)}
          hitSlop={8}
          className="pt-0.5">
          <Icon name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? palette.primary : palette.muted} />
        </Pressable>
        <Text className="flex-1 text-sm text-muted dark:text-muted-dark">
          I agree to the{' '}
          <Text accessibilityRole="link" onPress={() => openLink(LINKS.terms)} className="text-sm font-semibold text-primary dark:text-primary-dark">
            Terms of Use
          </Text>{' '}
          and{' '}
          <Text accessibilityRole="link" onPress={() => openLink(LINKS.privacy)} className="text-sm font-semibold text-primary dark:text-primary-dark">
            Privacy Policy
          </Text>
          . Circlo doesn’t tolerate abusive or objectionable content: you can report and block anyone, and accounts that
          break the terms are removed.
        </Text>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button size="lg" label="Continue" onPress={submit} loading={busy} disabled={!agreed} />
    </AuthScreen>
  );
}
