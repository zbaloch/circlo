import { Redirect, router } from 'expo-router';
import { View } from 'react-native';

import { usePreventScreenCapture } from 'expo-screen-capture';

import { AuthScreen } from '@/components/auth-screen';
import { Button, Title } from '@/components/form';
import { pendingSignup } from '@/lib/signup-store';
import { Text } from '@/components/ui/text';

/** Shows the 24-word recovery phrase once. It is the only way back in if the password is forgotten. */
export default function RecoveryPhraseScreen() {
  // Recovery words must never end up in screenshots, recordings or the recent-apps preview.
  usePreventScreenCapture('recovery-phrase');
  const signup = pendingSignup();
  if (!signup) return <Redirect href="/signup" />;

  return (
    <AuthScreen>
      <Title subtitle="Write these 24 words down, in order, and keep them somewhere safe. They are the only way to get back in if you forget your password. Halqo can’t reset it for you.">
        Your recovery phrase
      </Title>
      <View className="flex-row flex-wrap gap-2" accessibilityLabel="Recovery phrase, 24 words">
        {signup.words.map((w, i) => (
          <View key={i} className="w-[31%] flex-row gap-1 rounded-lg bg-surface-raised px-2 py-2 dark:bg-surface-raised-dark">
            <Text className="w-6 text-right text-muted dark:text-muted-dark">{i + 1}.</Text>
            <Text className="font-semibold text-ink dark:text-ink-dark">{w}</Text>
          </View>
        ))}
      </View>
      <Text className="text-sm text-muted dark:text-muted-dark">Don’t screenshot it or store it in a notes app.</Text>
      <Text className="text-sm text-muted dark:text-muted-dark">
        Your account is created when you confirm these words on the next screen. If you stop before then, nothing is
        saved and you can simply sign up again.
      </Text>
      <Button label="I’ve written it down" onPress={() => router.push('/confirm-phrase')} />
    </AuthScreen>
  );
}
