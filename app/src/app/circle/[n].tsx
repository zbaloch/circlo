import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, ErrorText, TextField } from '@/components/form';
import { describeError } from '@/lib/account';
import { DEFAULT_CIRCLE, loadAddressBook, type AddressBook, type Contact } from '@/lib/addressbook';
import { audienceSize, labelOf, membersOf, placeFriend, renameCircle } from '@/lib/circles';
import { useSession } from '@/lib/session';
import { Text } from '@/components/ui/text';

function name(c: Contact) {
  return c.displayName || (c.handle ? `@${c.handle}` : 'Friend');
}

/** One circle: rename it, see who's in it, move friends in or out. Every move is silent and rotates keys. */
export default function CircleScreen() {
  const { n } = useLocalSearchParams<{ n: string }>();
  const circle = Number(n);
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const [book, setBook] = useState<AddressBook | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const reload = useCallback(() => {
    if (!account) return;
    loadAddressBook(account).then(
      (b) => {
        setBook(b);
        setLabel(labelOf(b, circle));
      },
      (e) => setError(describeError(e)),
    );
  }, [account, circle]);
  useFocusEffect(reload);

  if (!account || !book) return null;
  const members = membersOf(book, circle);
  const others = Object.keys(book.contacts).filter((id) => !members.includes(id));

  const move = async (userId: string, to: number) => {
    setBusy(userId);
    setError(undefined);
    try {
      await placeFriend(account, userId, to);
      reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
      <Text className="text-muted dark:text-muted-dark">
        Circle {circle}. Posts to it are visible to {audienceSize(book, circle)} {audienceSize(book, circle) === 1 ? 'person' : 'people'}: this
        circle and every closer one.
      </Text>
      <TextField label="Name (only you see this)" value={label} onChangeText={setLabel} maxLength={40} />
      <Button
        label="Save name"
        variant="outline"
        loading={busy === 'label'}
        onPress={async () => {
          setBusy('label');
          await renameCircle(account, circle, label).catch((e) => setError(describeError(e)));
          setBusy(null);
          reload();
        }}
      />
      <ErrorText>{error}</ErrorText>

      {circle === 1 ? (
        <Text className="text-muted dark:text-muted-dark">Circle 1 is only you. Nobody else can be placed here.</Text>
      ) : (
        <>
          <Text className="text-lg font-bold text-ink dark:text-ink-dark">In this circle ({members.length})</Text>
          {members.map((id) => (
            <View key={id} className="flex-row items-center gap-3">
              <Avatar name={name(book.contacts[id])} />
              <Text className="flex-1 font-semibold text-ink dark:text-ink-dark">{name(book.contacts[id])}</Text>
              {circle !== DEFAULT_CIRCLE ? (
                <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => move(id, DEFAULT_CIRCLE)} className="px-2 py-1 active:opacity-60">
                  <Text className="font-semibold text-danger dark:text-danger-dark">{busy === id ? 'Moving…' : 'Remove'}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {others.length > 0 ? <Text className="pt-2 text-lg font-bold text-ink dark:text-ink-dark">Add to this circle</Text> : null}
          {others.map((id) => (
            <View key={id} className="flex-row items-center gap-3">
              <Avatar name={name(book.contacts[id])} />
              <View className="flex-1">
                <Text className="font-semibold text-ink dark:text-ink-dark">{name(book.contacts[id])}</Text>
                <Text className="text-muted dark:text-muted-dark">Now in: {labelOf(book, book.contacts[id].circle)}</Text>
              </View>
              <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => move(id, circle)} className="px-2 py-1 active:opacity-60">
                <Text className="font-semibold text-primary dark:text-primary-dark">{busy === id ? 'Moving…' : 'Add'}</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
