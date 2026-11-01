import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, ErrorText, TextField } from '@/components/form';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook, type Contact } from '@/lib/addressbook';
import { circleDefs, circleName, circlesOf, createCircle, deleteCircle, membersOf, renameCircle, setCircles } from '@/lib/circles';
import { showAlert } from '@/lib/dialog';
import { useSession } from '@/lib/session';
import { Text } from '@/components/ui/text';

function name(c: Contact) {
  return c.displayName || (c.handle ? `@${c.handle}` : 'Someone');
}

/**
 * One circle: name it, see who's in it, add or remove friends, or delete it. `n` is the circle's id, or "new" to make
 * one. Every membership change is silent: nobody is told.
 */
export default function CircleScreen() {
  const { n } = useLocalSearchParams<{ n: string }>();
  const isNew = n === 'new';
  const id = Number(n);
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
        setLabel(isNew ? '' : circleName(b, id));
      },
      (e) => setError(describeError(e)),
    );
  }, [account, id, isNew]);
  useFocusEffect(reload);

  if (!account || !book) return null;
  if (!isNew && !circleDefs(book).some((c) => c.id === id)) {
    return (
      <View className="flex-1 bg-surface p-5 dark:bg-surface-dark">
        <Text className="text-muted dark:text-muted-dark">This circle no longer exists.</Text>
      </View>
    );
  }

  const run = async (key: string, job: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    try {
      await job();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  if (isNew) {
    return (
      <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
        <Text className="text-muted dark:text-muted-dark">Posts to a circle are seen only by the people in it. Only you see its name.</Text>
        <TextField label="Name" value={label} onChangeText={setLabel} maxLength={40} autoFocus />
        <ErrorText>{error}</ErrorText>
        <Button
          label="Create circle"
          disabled={!label.trim()}
          loading={busy === 'create'}
          onPress={() =>
            run('create', async () => {
              const created = await createCircle(account, label);
              router.replace({ pathname: '/circle/[n]', params: { n: String(created) } });
            })
          }
        />
      </ScrollView>
    );
  }

  const members = membersOf(book, id);
  const others = Object.keys(book.contacts).filter((userId) => !members.includes(userId));
  const change = (userId: string, join: boolean) =>
    run(userId, async () => {
      const current = circlesOf(book, book.contacts[userId]);
      await setCircles(account, userId, join ? [...current, id] : current.filter((x) => x !== id));
      reload();
    });

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
      <Text className="text-muted dark:text-muted-dark">
        Posts to {circleName(book, id)} are seen only by the {members.length === 1 ? 'person' : `${members.length} people`} in it.
      </Text>
      <TextField label="Name (only you see this)" value={label} onChangeText={setLabel} maxLength={40} />
      <Button
        label="Save name"
        variant="outline"
        disabled={!label.trim() || label.trim() === circleName(book, id)}
        loading={busy === 'label'}
        onPress={() =>
          run('label', async () => {
            await renameCircle(account, id, label);
            reload();
          })
        }
      />
      <ErrorText>{error}</ErrorText>

      <Text className="text-lg font-bold text-ink dark:text-ink-dark">In this circle ({members.length})</Text>
      {members.length === 0 ? <Text className="text-muted dark:text-muted-dark">Nobody yet.</Text> : null}
      {members.map((userId) => (
        <View key={userId} className="flex-row items-center gap-3">
          <Avatar name={name(book.contacts[userId])} />
          <Text className="flex-1 font-semibold text-ink dark:text-ink-dark">{name(book.contacts[userId])}</Text>
          <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => change(userId, false)} className="px-2 py-1 active:opacity-60">
            <Text className="font-semibold text-danger dark:text-danger-dark">{busy === userId ? 'Updating…' : 'Remove'}</Text>
          </Pressable>
        </View>
      ))}
      {others.length > 0 ? <Text className="pt-2 text-lg font-bold text-ink dark:text-ink-dark">Add to this circle</Text> : null}
      {others.map((userId) => (
        <View key={userId} className="flex-row items-center gap-3">
          <Avatar name={name(book.contacts[userId])} />
          <Text className="flex-1 font-semibold text-ink dark:text-ink-dark">{name(book.contacts[userId])}</Text>
          <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => change(userId, true)} className="px-2 py-1 active:opacity-60">
            <Text className="font-semibold text-primary dark:text-primary-dark">{busy === userId ? 'Updating…' : 'Add'}</Text>
          </Pressable>
        </View>
      ))}

      <View className="pt-6">
        <Button
          label="Delete circle"
          variant="danger"
          loading={busy === 'delete'}
          onPress={() =>
            showAlert(`Delete ${circleName(book, id)}?`, 'Posts you already shared with it stay visible to the people who could see them.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () =>
                  run('delete', async () => {
                    await deleteCircle(account, id);
                    router.back();
                  }),
              },
            ])
          }
        />
      </View>
    </ScrollView>
  );
}
