import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AudienceBadge, CircleBadge } from '@/components/circle-badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MAX_CIRCLES, type AddressBook } from '@/lib/addressbook';
import { circleDefs, membersOf, nextCircleId, ONLY_ME, ONLY_ME_NOTE, ONLY_ME_TITLE, TO_EVERYONE } from '@/lib/circles';
import { usePalette } from '@/theme/use-palette';

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/**
 * Your circles: Only me and Everyone, then the circles you made (up to 8), each opening its screen, and New circle.
 * Shown in the People tab's Circles section and on the My Circles screen. Only you ever see circle names and who is in
 * them.
 */
export function CirclesList({ book }: { book: AddressBook }) {
  const palette = usePalette();
  const canAdd = nextCircleId(book) !== null;
  const row = 'flex-row items-center gap-3 rounded-xl border border-border p-4 dark:border-border-dark';
  return (
    <View className="gap-2">
      <Text className="pb-2 text-muted dark:text-muted-dark">
        Posts to a circle are seen only by the people in it. Put someone in as many circles as you like; changes are
        silent: nobody is told, and Circlo can’t see them either.
      </Text>
      <View className={row}>
        <AudienceBadge book={book} audience={ONLY_ME} />
        <View className="flex-1">
          <Text className="text-base font-bold text-ink dark:text-ink-dark">{ONLY_ME_TITLE}</Text>
          <Text className="text-muted dark:text-muted-dark">{ONLY_ME_NOTE}</Text>
        </View>
      </View>
      <View className={row}>
        <AudienceBadge book={book} audience={TO_EVERYONE} />
        <View className="flex-1">
          <Text className="text-base font-bold text-ink dark:text-ink-dark">Everyone</Text>
          <Text className="text-muted dark:text-muted-dark">All your people · {people(Object.values(book.contacts).filter((c) => c.status === 'accepted').length)}</Text>
        </View>
      </View>
      <Text className="pt-4 text-xs font-semibold uppercase text-muted dark:text-muted-dark">Your circles</Text>
      {circleDefs(book).map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          accessibilityLabel={`${c.name}, ${people(membersOf(book, c.id).length)}`}
          onPress={() => router.push({ pathname: '/circle/[n]', params: { n: String(c.id) } })}
          className={`${row} active:opacity-60`}>
          <CircleBadge book={book} id={c.id} />
          <View className="flex-1">
            <Text className="text-base font-bold text-ink dark:text-ink-dark">{c.name}</Text>
            <Text className="text-muted dark:text-muted-dark">{people(membersOf(book, c.id).length)} · only they see posts to it</Text>
          </View>
          <Icon name="chevron-forward" size={20} color={palette.muted} />
        </Pressable>
      ))}
      {canAdd ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/circle/[n]', params: { n: 'new' } })}
          className="items-center rounded-xl border border-dashed border-border p-4 active:opacity-60 dark:border-border-dark">
          <Text className="font-bold text-primary dark:text-primary-dark">New circle</Text>
        </Pressable>
      ) : (
        <Text className="text-center text-muted dark:text-muted-dark">You can have up to {MAX_CIRCLES} circles.</Text>
      )}
    </View>
  );
}
