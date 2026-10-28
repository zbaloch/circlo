import { Icon, type IconName } from '@/components/ui/icon';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { AddressBook, Audience } from '@/lib/addressbook';
import { circleName } from '@/lib/circles';
import { usePalette } from '@/theme/use-palette';

function Badge({ small, children }: { small: boolean; children: React.ReactNode }) {
  const box = small ? 'h-8 w-8' : 'h-9 w-9';
  return <View className={`${box} items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark`}>{children}</View>;
}

/** A circle's badge: its first letter (a star for Close Friends, id 1). */
export function CircleBadge({ book, id, small = false }: { book: Pick<AddressBook, 'circleDefs'>; id: number; small?: boolean }) {
  const palette = usePalette();
  const name = circleName(book, id);
  return (
    <Badge small={small}>
      {id === 1 && name === 'Close Friends' ? (
        <Icon name="star" size={small ? 15 : 17} color={palette.primary} />
      ) : (
        <Text className={`font-bold text-primary dark:text-primary-dark ${small ? 'text-sm' : ''}`}>{[...name][0]?.toUpperCase()}</Text>
      )}
    </Badge>
  );
}

/** An audience's badge: a lock for Only me, a globe for Everyone, the circle's badge (or a group icon for several). */
export function AudienceBadge({ book, audience, small = false }: { book: Pick<AddressBook, 'circleDefs'>; audience: Audience; small?: boolean }) {
  const palette = usePalette();
  if (audience.kind === 'circles' && audience.ids.length === 1) return <CircleBadge book={book} id={audience.ids[0]} small={small} />;
  const icon: IconName = audience.kind === 'onlyMe' ? 'lock-closed' : audience.kind === 'everyone' ? 'globe-outline' : 'people-outline';
  return (
    <Badge small={small}>
      <Icon name={icon} size={small ? 15 : 17} color={palette.primary} />
    </Badge>
  );
}
