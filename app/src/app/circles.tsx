import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { audienceSize, labelOf, listedCircles, membersOf, nextCustomCircle, resumePendingRotation } from '@/lib/circles';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';

/** Your circles, nearest first. Only you ever see these labels and who is in which circle. */
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
          A post to a circle is visible to that circle and every closer one. Moving someone is silent: nobody is told,
          and Circlo can’t see it either.
        </Text>
        {book.pendingRotation ? <Text className="text-primary dark:text-primary-dark">Updating keys…</Text> : null}
        <ErrorText>{error}</ErrorText>
        {listedCircles(book).map((n) => {
          const members = membersOf(book, n).length;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`${labelOf(book, n)}, ${members} people`}
              onPress={() => router.push({ pathname: '/circle/[n]', params: { n: String(n) } })}
              className="flex-row items-center gap-3 rounded-xl border border-border p-4 active:opacity-60 dark:border-border-dark">
              <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark">
                <Text className="font-bold text-primary dark:text-primary-dark">{n}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-bold text-ink dark:text-ink-dark">{labelOf(book, n)}</Text>
                <Text className="text-muted dark:text-muted-dark">
                  {n === 1 ? 'Only you' : `${members} in this circle · ${audienceSize(book, n)} can see posts to it`}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={palette.muted} />
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
