import { usePreventScreenCapture } from 'expo-screen-capture';
import { Redirect, router } from 'expo-router';
import { Share, View } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, Title } from '@/components/form';
import { PhraseWords } from '@/components/phrase-words';
import { Text } from '@/components/ui/text';
import { pendingSignup } from '@/lib/signup-store';
import { useFinishSignup } from '@/lib/use-finish-signup';

/**
 * The 12-word recovery phrase, when Face ID recovery isn't available or the user prefers it. Shown once; there's no word
 * quiz (docs/PASSKEY_RECOVERY.md). It can be shared straight into a password manager.
 */
export default function RecoveryPhraseScreen() {
  // Recovery words must never end up in screenshots, recordings or the recent-apps preview.
  usePreventScreenCapture('recovery-phrase');
  const signup = pendingSignup();
  const { finish, error, busy, expired } = useFinishSignup();
  if (!signup) return <Redirect href="/signup" />;

  return (
    <AuthScreen>
      <Title subtitle="Keep these 12 words somewhere safe, like your password manager or on paper. They’re the only way back in if you forget your password: Circlo can’t reset it for you.">
        Your recovery phrase
      </Title>
      <PhraseWords words={signup.words} />
      <View className="gap-2">
        <Button
          variant="outline"
          label="Save to a password manager"
          onPress={() => Share.share({ message: signup.words.join(' ') }).catch(() => undefined)}
        />
        <Text className="text-sm text-muted dark:text-muted-dark">
          Choose your password manager in the share sheet. Avoid notes apps and messages.
        </Text>
      </View>
      <ErrorText>{error}</ErrorText>
      {expired ? (
        <Button size="lg" label="Start again" onPress={() => router.replace('/signup')} />
      ) : (
        <Button size="lg" label="I’ve saved it" onPress={() => finish(signup, { kind: 'phrase' })} loading={busy} />
      )}
    </AuthScreen>
  );
}
