import { Pressable, View } from 'react-native';

import { CircloMark } from './circlo-mark';
import { Text } from '@/components/ui/text';

type Props = { title: string; body?: string; actionLabel?: string; onAction?: () => void };

/** Empty states have an illustration and a call to action (PLAN.md 2A polish). */
export function EmptyState({ title, body, actionLabel, onAction }: Props) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-10">
      <CircloMark size="lg" />
      <Text className="mt-4 text-center text-2xl font-bold text-ink dark:text-ink-dark">{title}</Text>
      {body ? <Text className="text-center text-base text-muted dark:text-muted-dark">{body}</Text> : null}
      {actionLabel ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          className="mt-3 rounded-full bg-primary px-6 py-3 active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark">
          <Text className="text-base font-bold text-on-primary dark:text-on-primary-dark">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
