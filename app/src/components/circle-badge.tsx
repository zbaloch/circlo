import { Icon } from '@/components/ui/icon';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { CLOSE_FRIENDS, type AddressBook } from '@/lib/addressbook';
import { levelOf, ONLY_ME } from '@/lib/circles';
import { usePalette } from '@/theme/use-palette';

/** A circle's badge: a lock for Only me (level 0), a star for Close Friends, otherwise its level 1, 2, 3… */
export function CircleBadge({ book, circle, small = false }: { book: AddressBook; circle: number; small?: boolean }) {
  const palette = usePalette();
  const box = small ? 'h-8 w-8' : 'h-9 w-9';
  const icon = circle === ONLY_ME ? 'lock-closed' : circle === CLOSE_FRIENDS ? 'star' : null;
  return (
    <View className={`${box} items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark`}>
      {icon ? (
        <Icon name={icon} size={small ? 15 : 17} color={palette.primary} />
      ) : (
        <Text className={`font-bold text-primary dark:text-primary-dark ${small ? 'text-sm' : ''}`}>{levelOf(book, circle)}</Text>
      )}
    </View>
  );
}
