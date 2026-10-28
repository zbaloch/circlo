import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, ErrorText, TextField } from '@/components/form';
import { describeError } from '@/lib/account';
import { CLOSE_FRIENDS, DEFAULT_CIRCLE, loadAddressBook, type AddressBook, type Contact } from '@/lib/addressbook';
import { audienceSize, labelOf, levelOf, membersOf, ONLY_ME, placeFriend, renameCircle, setCloseFriend } from '@/lib/circles';
import { useSession } from '@/lib/session';
import { Text } from '@/components/ui/text';

function name(c: Contact) {
  return c.displayName || (c.handle ? `@${c.handle}` : 'Friend');
}

/**
 * One circle: rename it, see who's in it, move friends in or out. For Close Friends (exclusive), adding or removing
 * someone toggles membership instead. Every change is silent and rotates keys.
 */
export default function CircleScreen() {
  const { n } = useLocalSearchParams<{ n: string }>();
  const circle = Number(n);
  const isClose = circle === CLOSE_FRIENDS;
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
  const audience = audienceSize(book, circle);
  const people = `${audience} ${audience === 1 ? 'person' : 'people'}`;

  const change = async (userId: string, join: boolean) => {
    setBusy(userId);
    setError(undefined);
    try {
      if (isClose) await setCloseFriend(account, userId, join);
      else await placeFriend(account, userId, join ? circle : DEFAULT_CIRCLE);
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
        {isClose
          ? `Close Friends is separate from your other circles: only the ${people} here see what you post to it, whatever circle anyone else is in.`
          : circle === ONLY_ME
            ? 'Level 0. Posts here are visible only to you.'
            : `Level ${levelOf(book, circle)}. Posts to it are visible to ${people}: this circle and every closer one.`}
      </Text>
      {isClose ? null : (
        <>
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
        </>
      )}
      <ErrorText>{error}</ErrorText>

      {circle === ONLY_ME ? (
        <Text className="text-muted dark:text-muted-dark">This is only you. Nobody else can be placed here.</Text>
      ) : (
        <>
          <Text className="text-lg font-bold text-ink dark:text-ink-dark">In this circle ({members.length})</Text>
          {members.map((id) => (
            <View key={id} className="flex-row items-center gap-3">
              <Avatar name={name(book.contacts[id])} />
              <Text className="flex-1 font-semibold text-ink dark:text-ink-dark">{name(book.contacts[id])}</Text>
              {isClose || circle !== DEFAULT_CIRCLE ? (
                <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => change(id, false)} className="px-2 py-1 active:opacity-60">
                  <Text className="font-semibold text-danger dark:text-danger-dark">{busy === id ? 'Updating…' : 'Remove'}</Text>
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
              <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => change(id, true)} className="px-2 py-1 active:opacity-60">
                <Text className="font-semibold text-primary dark:text-primary-dark">{busy === id ? 'Updating…' : 'Add'}</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
