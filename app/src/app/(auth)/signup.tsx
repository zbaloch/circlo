import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { PasswordStrength } from '@/components/password-strength';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { describeError, looksLikeEmail, startSignup } from '@/lib/account';
import { LINKS, openLink } from '@/lib/links';
import { checkPassword } from '@/lib/password-strength';
import { checkUsername } from '@/lib/username';
import { usePalette } from '@/theme/use-palette';

/** Sign up: username, email and password (a name can be added later in Edit profile). A code is emailed next to confirm the address. */
export default function SignupScreen() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const palette = usePalette();
  const strength = checkPassword(password, username);
  const handle = checkUsername(username);

  const submit = async () => {
    setError(undefined);
    if (!handle.ok) return setError(handle.problem ?? 'Choose a username: 3–30 letters, numbers and _.');
    if (!looksLikeEmail(email)) return setError('That doesn’t look like an email address.');
    if (!strength.ok) return setError(strength.problem ?? 'Choose a stronger password.');
    setBusy(true);
    try {
      const sentTo = await startSignup({ username: handle.handle, email, password });
      router.push({ pathname: '/verify-email', params: { email: sentTo } });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <Title subtitle="Your @username is what your people see; you can add your name later. Nobody can look you up: you connect by invite.">Create your account</Title>
      <View className="gap-1">
        {/* Capitals are made small as you type, so the field shows the username people will see. */}
        <TextField label="Username" placeholder="e.g. sam_k" value={username} onChangeText={(t) => setUsername(t.toLowerCase())} maxLength={31} textContentType="username" autoComplete="username-new" />
        {handle.ok ? (
          <Text className="text-sm text-muted dark:text-muted-dark">Your username: @{handle.handle}</Text>
        ) : handle.problem ? (
          <View className="gap-1">
            <Text className="text-sm text-danger dark:text-danger-dark">{handle.problem}</Text>
            {handle.suggestion ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Use @${handle.suggestion}`} onPress={() => setUsername(handle.suggestion!)} hitSlop={6} className="self-start active:opacity-60">
                <Text className="text-sm font-semibold text-primary dark:text-primary-dark">Use @{handle.suggestion}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <TextField label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" hint="Only for signing in and resetting your password. It’s never shown to anyone." />
      <TextField label="Password" secureTextEntry value={password} onChangeText={setPassword} textContentType="newPassword" autoComplete="new-password" />
      <PasswordStrength check={strength} empty={!password} />
      <View className="flex-row items-start gap-3">
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I’m 16 or older and agree to the Terms of Use and Privacy Policy"
          onPress={() => setAgreed(!agreed)}
          hitSlop={8}
          className="pt-0.5">
          <Icon name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? palette.primary : palette.muted} />
        </Pressable>
        <Text className="flex-1 text-sm text-muted dark:text-muted-dark">
          {/* Circlo is for people 16 and over (Terms of Use, the stores' age ratings). */}
          I’m 16 or older and agree to the{' '}
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
