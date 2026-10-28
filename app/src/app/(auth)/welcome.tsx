import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/form';
import { CircloMark } from '@/components/circlo-mark';
import { Text } from '@/components/ui/text';

export default function WelcomeScreen() {
  return (
    <SafeAreaView className="flex-1 bg-surface px-6 dark:bg-surface-dark">
      <View className="flex-1 items-center justify-center gap-6">
        <CircloMark size="lg" />
        <Text className="text-4xl font-bold text-ink dark:text-ink-dark">Circlo</Text>
        <Text className="text-center text-lg text-muted dark:text-muted-dark">
          Share with your circles. Everything is end-to-end encrypted: not even Circlo can read it.
        </Text>
      </View>
      <View className="gap-3 pb-6">
        <Button label="Create account" onPress={() => router.push('/signup')} />
        <Button label="Log in" variant="outline" onPress={() => router.push('/login')} />
      </View>
    </SafeAreaView>
  );
}
