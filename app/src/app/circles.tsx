import { Icon } from '@/components/ui/icon';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { CircleBadge } from '@/components/circle-badge';
import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { describeError } from '@/lib/account';
import { CLOSE_FRIENDS, loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { audienceSize, labelOf, listedCircles, membersOf, nextCustomCircle, ONLY_ME, resumePendingRotation } from '@/lib/circles';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';

/**
 * Your circles, nearest first: Only me (level 0), then the nested circles, then Close Friends (exclusive). Only you
 * ever see these labels and who is in which circle.
 */
export default function CirclesScreen() {
  const session = useSession();
  const palette = usePalette();
  const account = session.status === 'signedIn' ? session.account : null;
  const [book, setBook] = useState<AddressBook | null>(null);
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      if (!account) return;
      loadAddressBook(account)
        .then(setBook)
        .then(() => resumePendingRotation(account))
        .then((resumed) => (resumed ? loadAddressBook(account).then(setBook) : undefined))
        .catch((e) => setError(describeError(e)));
    }, [account]),
  );

  if (!account || !book) return <Screen>{error ? <ErrorText>{error}</ErrorText> : null}</Screen>;
  const custom = nextCustomCircle(book);

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-2 p-4">
        <Text className="pb-2 text-muted dark:text-muted-dark">
          A post to a circle is visible to that circle and every closer one. Close Friends is separate: only the people
          in it see what you post there. Moving someone is silent: nobody is told, and Circlo can’t see it either.
        </Text>
        {book.pendingRotation ? <Text className="text-primary dark:text-primary-dark">Updating keys…</Text> : null}
        <ErrorText>{error}</ErrorText>
        {[...listedCircles(book), CLOSE_FRIENDS].map((n) => {
          const members = membersOf(book, n).length;
          const detail =
            n === ONLY_ME
              ? 'Only you'
              : n === CLOSE_FRIENDS
                ? `${members} ${members === 1 ? 'person' : 'people'} · only they see posts to it`
                : `${members} in this circle · ${audienceSize(book, n)} can see posts to it`;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`${labelOf(book, n)}, ${members} people`}
              onPress={() => router.push({ pathname: '/circle/[n]', params: { n: String(n) } })}
              className="flex-row items-center gap-3 rounded-xl border border-border p-4 active:opacity-60 dark:border-border-dark">
              <CircleBadge book={book} circle={n} />
              <View className="flex-1">
                <Text className="text-base font-bold text-ink dark:text-ink-dark">{labelOf(book, n)}</Text>
                <Text className="text-muted dark:text-muted-dark">{detail}</Text>
              </View>
              <Icon name="chevron-forward" size={20} color={palette.muted} />
            </Pressable>
          );
        })}
        {custom ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/circle/[n]', params: { n: String(custom) } })}
            className="items-center rounded-xl border border-dashed border-border p-4 active:opacity-60 dark:border-border-dark">
            <Text className="font-bold text-primary dark:text-primary-dark">Add a custom circle</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
