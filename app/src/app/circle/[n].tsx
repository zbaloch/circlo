import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, ErrorText, TextField } from '@/components/form';
import { PersonRow, RowButton } from '@/components/person-row';
import { Toggle } from '@/components/ui/toggle';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook, type Contact } from '@/lib/addressbook';
import { membersVisibleChange } from '@/lib/circle-mates';
import {
  circleDefs,
  circleName,
  circlesOf,
  createCircle,
  deleteCircle,
  confirmMembership,
  hasFixedName,
  membersOf,
  renameCircle,
  setCircles,
  setMembersVisible,
} from '@/lib/circles';
import { showAlert } from '@/lib/dialog';
import { useSession } from '@/lib/session';
import { showToast } from '@/lib/toast';
import { Text } from '@/components/ui/text';

function name(c: Contact) {
  return c.displayName || (c.handle ? `@${c.handle}` : 'Someone');
}

/**
 * One circle: name it, see who's in it (X followers-list rows that open each profile), add or remove friends after a
 * confirmation, or delete it. The starter circles keep their names (owner decision 2026-11-20). `n` is the circle's id, or "new" to make one. Every membership change is silent: nobody
 * is told. A switch lets its people see each other on my profile, never its name (owner decision 2026-11-20).
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
              router.replace({
                pathname: '/circle/[n]',
                params: { n: String(created) },
              });
            })
          }
        />
      </ScrollView>
    );
  }

  const members = membersOf(book, id);
  const others = Object.keys(book.contacts).filter((userId) => !members.includes(userId));
  const circle = circleName(book, id);
  const visible = circleDefs(book).find((c) => c.id === id)?.membersVisible ?? false;
  // Who sees whom changes, so it's confirmed first, saying what it means, and a toast says it's done. Nobody is told.
  const switchVisible = (on: boolean) => {
    const what = membersVisibleChange(circle, members.length, on);
    showAlert(what.title, what.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: what.confirm,
        style: on ? 'default' : 'destructive',
        onPress: () =>
          void run('visible', async () => {
            await setMembersVisible(account, id, on);
            showToast(what.done);
            reload();
          }),
      },
    ]);
  };
  // Adding or removing someone changes what they can see (earlier posts too), so it's confirmed first and a toast says
  // it's done. Nobody is told.
  const change = (userId: string, join: boolean) =>
    confirmMembership(name(book.contacts[userId]), circle, join, (done) =>
      void run(userId, async () => {
        const current = circlesOf(book, book.contacts[userId]);
        await setCircles(account, userId, join ? [...current, id] : current.filter((x) => x !== id));
        showToast(done);
        reload();
      }),
    );
  const row = (userId: string, join: boolean) => {
    const c = book.contacts[userId];
    return (
      <PersonRow
        key={userId}
        id={userId}
        name={name(c)}
        handle={c.handle}
        bio={c.bio}
        avatarUrl={c.avatarUrl}
        onPress={() => router.push({ pathname: '/friend/[id]', params: { id: userId } })}
        action={
          <RowButton
            label={join ? 'Add' : 'Remove'}
            accessibilityLabel={join ? `Add ${name(c)} to ${circle}` : `Remove ${name(c)} from ${circle}`}
            filled={join}
            busy={busy === userId}
            disabled={!!busy}
            onPress={() => change(userId, join)}
          />
        }
      />
    );
  };

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView className="flex-1" contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
        <Text className="text-muted dark:text-muted-dark">
          Posts to {circleName(book, id)} are seen only by the {members.length === 1 ? 'person' : `${members.length} people`} in it.
        </Text>
        {hasFixedName(circleName(book, id)) ? (
          <Text className="text-[13px] leading-[18px] text-muted dark:text-muted-dark">
            {circleName(book, id)} is one of Circlo’s starter circles, so its name stays. Only you see it.
          </Text>
        ) : (
          <>
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
          </>
        )}
        <View className="flex-row items-center gap-4">
          <View className="flex-1 gap-0.5">
            <Text className="text-[15px] font-semibold text-ink dark:text-ink-dark">People in this circle can see each other</Text>
            <Text className="text-[13px] leading-[18px] text-muted dark:text-muted-dark">
              They see each other on your profile and can ask each other to connect. They never see the circle’s name.
            </Text>
          </View>
          <Toggle accessibilityLabel="People in this circle can see each other" value={visible} disabled={!!busy} onValueChange={switchVisible} />
        </View>
        <ErrorText>{error}</ErrorText>

        <View>
          <Text className="text-lg font-bold text-ink dark:text-ink-dark">In this circle ({members.length})</Text>
          {members.length === 0 ? <Text className="pt-1 text-muted dark:text-muted-dark">Nobody yet.</Text> : null}
          {members.map((userId) => row(userId, false))}
        </View>
        {others.length > 0 ? (
          <View>
            <Text className="pt-2 text-lg font-bold text-ink dark:text-ink-dark">Add to this circle</Text>
            {others.map((userId) => row(userId, true))}
          </View>
        ) : null}

        {/* Deleting is rare and can't be undone, so it's a quiet link at the very bottom, not a big button. */}
        <View className="mt-4 border-t border-border pt-4 dark:border-border-dark">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete circle"
            disabled={!!busy}
            hitSlop={8}
            className="self-start py-2 active:opacity-60"
            onPress={() =>
              showAlert(`Delete ${circle}?`, 'Posts you already shared with it stay visible to the people who could see them.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () =>
                    void run('delete', async () => {
                      await deleteCircle(account, id);
                      showToast(`${circle} deleted`);
                      router.back();
                    }),
                },
              ])
            }>
            <Text className="font-semibold text-danger dark:text-danger-dark">{busy === 'delete' ? 'Deleting…' : 'Delete circle'}</Text>
          </Pressable>
        </View>
      </ScrollView>
      {/* The main action: finished here, back to My Circles (adding and removing save as you go). */}
      <View className="border-t border-border bg-surface px-5 pb-6 pt-3 dark:border-border-dark dark:bg-surface-dark">
        <Button size="lg" label="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/search', params: { section: 'circles' } }))} />
      </View>
    </View>
  );
}
