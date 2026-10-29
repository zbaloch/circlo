import { View } from 'react-native';

import { CircloSymbol } from './circlo-mark';
import { Button } from './form';
import { Text } from '@/components/ui/text';

type Props = { title: string; body?: string; actionLabel?: string; onAction?: () => void };

/** Empty states have an illustration and a call to action (PLAN.md 2A polish). */
export function EmptyState({ title, body, actionLabel, onAction }: Props) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-10">
      <CircloSymbol size="lg" />
      <Text className="mt-4 text-center text-2xl font-bold text-ink dark:text-ink-dark">{title}</Text>
      {body ? <Text className="text-center text-base text-muted dark:text-muted-dark">{body}</Text> : null}
      {actionLabel && onAction ? (
        <View className="mt-3">
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
