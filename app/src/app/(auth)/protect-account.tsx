import { Redirect, router } from 'expo-router';
import { Platform, Pressable } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, Title } from '@/components/form';
import { Text } from '@/components/ui/text';
import { BIOMETRIC, createRecoveryPasskey, isCancelled, PasskeyUnavailableError, passkeySupported } from '@/lib/passkey';
import { pendingSignup } from '@/lib/signup-store';
import { useFinishSignup } from '@/lib/use-finish-signup';

/**
 * The last signup step (docs/PASSKEY_RECOVERY.md): a way back in if the password is ever forgotten. Face ID (a passkey
 * in iCloud Keychain / Google Password Manager) is one tap; where it isn't available, the 12-word phrase is offered.
 */
export default function ProtectAccountScreen() {
  const signup = pendingSignup();
  const { finish, error, setError, busy, setBusy, expired } = useFinishSignup();
  const supported = passkeySupported();
  if (!signup) return <Redirect href="/signup" />;

  const usePasskey = async () => {
    setError(undefined);
    setBusy(true);
    let prf: ArrayBuffer;
    try {
      prf = await createRecoveryPasskey(signup.handle);
    } catch (e) {
      setBusy(false);
      if (isCancelled(e)) return;
      if (__DEV__) {
        const error = e as { error?: unknown; code?: unknown; message?: unknown };
        console.warn('[passkey setup failed]', { error: error.error, code: error.code, message: error.message });
      }
      setError(
        e instanceof PasskeyUnavailableError
          ? 'Your password manager can’t be used for recovery. Use a recovery phrase instead.'
          : 'Couldn’t save the passkey. Try again, or use a recovery phrase instead.',
      );
      return;
    }
    await finish(signup, { kind: 'passkey', prf });
  };

  return (
    <AuthScreen>
      <Title
        subtitle={
          supported
            ? `If you ever forget your password, ${BIOMETRIC} gets you back in. It’s saved as a passkey in your ${Platform.OS === 'ios' ? 'iCloud Keychain' : 'Google Password Manager'}, and Circlo never sees it.`
            : 'If you ever forget your password, a recovery phrase is the only way back in: Circlo can’t reset it, because your posts are end-to-end encrypted.'
        }>
        Protect your account
      </Title>
      <ErrorText>{error}</ErrorText>
      {expired ? (
        <Button size="lg" label="Start again" onPress={() => router.replace('/signup')} />
      ) : supported ? (
        <>
          <Button size="lg" label={`Use ${BIOMETRIC}`} onPress={usePasskey} loading={busy} />
          <Pressable accessibilityRole="link" disabled={busy} onPress={() => router.push('/recovery-phrase')} className="items-center py-2">
            <Text className="font-semibold text-primary dark:text-primary-dark">Use a recovery phrase instead</Text>
          </Pressable>
        </>
      ) : (
        <Button size="lg" label="Show my recovery phrase" onPress={() => router.push('/recovery-phrase')} />
      )}
    </AuthScreen>
  );
}
