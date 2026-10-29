import { View } from 'react-native';

import { Button } from './form';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { usePalette } from '@/theme/use-palette';

type Props = { icon?: IconName; title: string; body?: string; actionLabel?: string; onAction?: () => void };

/** Empty states have an icon that says what belongs here and a call to action (PLAN.md 2A polish). */
export function EmptyState({ icon, title, body, actionLabel, onAction }: Props) {
  const palette = usePalette();
  return (
    <View className="flex-1 items-center justify-center gap-3 px-10">
      {icon ? (
        <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark">
          <Icon name={icon} size={36} color={palette.primary} />
        </View>
      ) : null}
      <Text className="text-center text-2xl font-bold text-ink dark:text-ink-dark">{title}</Text>
      {body ? <Text className="text-center text-base text-muted dark:text-muted-dark">{body}</Text> : null}
      {actionLabel && onAction ? (
        <View className="mt-3">
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
