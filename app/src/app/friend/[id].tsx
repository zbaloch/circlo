import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, ErrorText } from '@/components/form';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { labelOf, listedCircles, placeFriend, unfriend } from '@/lib/circles';
import { displayName, useConnections } from '@/lib/use-connections';
import { usePalette } from '@/theme/use-palette';

/**
 * A friend's profile, decrypted on this device. The circle section is author-only: it shows MY placement of this
 * friend, on my phone; they are never told and never see any circle label (PLAN.md 2A).
 */
export default function FriendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const { account, connections, refresh } = useConnections();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const reloadBook = useCallback(() => {
    if (account) void loadAddressBook(account).then(setBook);
  }, [account]);
  useFocusEffect(reloadBook);

  const c = connections?.find((x) => x.userId === id);
  if (!account || !c) return null;
  const contact = book?.contacts[c.userId];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="items-center gap-3 px-6 pb-10 pt-8">
      <Avatar size="lg" name={displayName(c)} />
      <Text className="text-2xl font-bold text-ink dark:text-ink-dark">{displayName(c)}</Text>
      {c.profile?.handle ? <Text className="text-muted dark:text-muted-dark">@{c.profile.handle}</Text> : null}
      {c.profile?.bio ? <Text className="text-center text-base text-ink dark:text-ink-dark">{c.profile.bio}</Text> : null}
      {c.status !== 'accepted' ? <Text className="text-muted dark:text-muted-dark">Friend request pending</Text> : null}

      {c.identityChanged ? (
        <View className="mt-4 w-full gap-2 rounded-xl border border-danger p-4 dark:border-danger-dark">
          <Text className="font-bold text-danger dark:text-danger-dark">Security keys changed</Text>
          <Text className="text-ink dark:text-ink-dark">
            {displayName(c)}’s keys are different from the ones you saw before. This happens if they reset their account,
            but it can also mean someone is trying to impersonate them. Compare safety numbers before trusting them.
          </Text>
        </View>
      ) : (
        <View className="mt-4 flex-row items-center gap-2">
          <Ionicons name={c.verified ? 'shield-checkmark' : 'shield-outline'} size={20} color={c.verified ? palette.primary : palette.muted} />
          <Text className="text-muted dark:text-muted-dark">{c.verified ? 'Verified in person' : 'Not verified yet'}</Text>
        </View>
      )}
      <View className="w-full pt-2">
        <Button
          label={c.identityChanged ? 'Review safety number' : 'Safety number'}
          variant="outline"
          onPress={() => router.push({ pathname: '/safety/[id]', params: { id: c.userId } })}
        />
      </View>

      {contact && book ? (
        <View className="mt-4 w-full gap-3 rounded-xl border border-border p-4 dark:border-border-dark">
          <View className="flex-row items-center gap-2">
            <Ionicons name="lock-closed" size={16} color={palette.muted} />
            <Text className="text-sm text-muted dark:text-muted-dark">Only you can see this</Text>
          </View>
          <Text className="text-base text-ink dark:text-ink-dark">
            In circle: <Text className="font-bold">{labelOf(book, contact.circle)}</Text>
          </Text>
          {picking ? (
            <View className="gap-1">
              {listedCircles(book)
                .filter((n) => n >= 2)
                .map((n) => (
                  <Pressable
                    key={n}
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        await placeFriend(account, c.userId, n);
                        setPicking(false);
                        reloadBook();
                      })
                    }
                    className={`flex-row items-center justify-between rounded-lg px-3 py-3 active:opacity-60 ${n === contact.circle ? 'bg-primary-soft dark:bg-primary-soft-dark' : ''}`}>
                    <Text className="text-ink dark:text-ink-dark">
                      {n}. {labelOf(book, n)}
                    </Text>
                    {n === contact.circle ? <Ionicons name="checkmark" size={18} color={palette.primary} /> : null}
                  </Pressable>
                ))}
            </View>
          ) : (
            <Button label="Move to another circle" variant="outline" loading={busy} onPress={() => setPicking(true)} />
          )}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              Alert.alert('Unfriend?', `${displayName(c)} won’t be able to read anything you post from now on. They aren’t notified.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Unfriend',
                  style: 'destructive',
                  onPress: () =>
                    run(async () => {
                      await unfriend(account, c.userId);
                      await refresh();
                      router.back();
                    }),
                },
              ])
            }
            className="items-center py-2 active:opacity-60">
            <Text className="font-semibold text-danger dark:text-danger-dark">Unfriend</Text>
          </Pressable>
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
