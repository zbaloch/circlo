import { Icon, type IconName } from '@/components/ui/icon';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/form';
import { CircloWordmark } from '@/components/circlo-mark';
import { Text } from '@/components/ui/text';
import { usePalette } from '@/theme/use-palette';

type Point = { icon: IconName; title: string; body: string };

const POINTS: Point[] = [
  {
    icon: 'people-outline',
    title: 'Share with your circles',
    body: 'Put people in circles like Family, Kids or Close Friends. Post to one or more circles and only the people in them can see it, or share with Everyone, or keep it for yourself.',
  },
  {
    icon: 'eye-off-outline',
    title: 'Only the people you choose',
    body: 'You connect by invite only, nobody can look you up, and nobody is ever told which circle they’re in. No ads and no tracking.',
  },
];

export default function WelcomeScreen() {
  const palette = usePalette();
  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView contentContainerClassName="flex-grow justify-center gap-8 px-6 py-6" showsVerticalScrollIndicator={false}>
        <View className="items-center gap-5">
          <CircloWordmark height={52} />
          <Text className="text-center text-lg text-muted dark:text-muted-dark">A private social network for the people you choose.</Text>
        </View>
        <View className="gap-5">
          {POINTS.map((p) => (
            <View key={p.title} className="flex-row gap-4">
              <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark">
                <Icon name={p.icon} size={22} color={palette.primary} />
              </View>
              <View className="flex-1 gap-1">
                <Text className="text-base font-bold text-ink dark:text-ink-dark">{p.title}</Text>
                <Text className="text-[15px] leading-5 text-muted dark:text-muted-dark">{p.body}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <View className="gap-3 px-6 pb-6 pt-3">
        <Button size="lg" label="Create account" onPress={() => router.push('/signup')} />
        <Button size="lg" label="Log in" variant="outline" onPress={() => router.push('/login')} />
      </View>
    </SafeAreaView>
  );
}
