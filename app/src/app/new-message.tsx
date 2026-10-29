import { Icon } from '@/components/ui/icon';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, ErrorText } from '@/components/form';
import { authorName } from '@/components/post-actions';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { addPeople, startChat } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';

/** Pick friends for a new chat, or (with `group`) people to add to an existing one. */
export default function NewMessageScreen() {
  const { group, exclude } = useLocalSearchParams<{ group?: string; exclude?: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const palette = usePalette();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (account) loadAddressBook(account).then(setBook, () => {});
  }, [account]);

  if (!account) return null;
  const skip = new Set((exclude ?? '').split(',').filter(Boolean));
  const friends = Object.entries(book?.contacts ?? {})
    .filter(([id, c]) => !skip.has(id) && !c.identityChanged)
    .map(([id]) => id)
    .sort((a, b) => authorName(account, book, a).name.localeCompare(authorName(account, book, b).name));

  const go = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (group) {
        await addPeople(account, group, picked);
        router.back();
      } else {
        const id = await startChat(account, picked);
        router.replace({ pathname: '/chat/[id]', params: { id } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <FlatList
        data={friends}
        keyExtractor={(id) => id}
        ListEmptyComponent={<Text className="p-6 text-center text-muted dark:text-muted-dark">Add people first to message them.</Text>}
        renderItem={({ item }) => {
          const on = picked.includes(item);
          const { name, handle } = authorName(account, book, item);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => setPicked(on ? picked.filter((x) => x !== item) : [...picked, item])}
              className="flex-row items-center gap-3 border-b border-border px-4 py-3 dark:border-border-dark">
              <Avatar name={name} />
              <View className="flex-1">
                <Text className="text-base font-semibold text-ink dark:text-ink-dark">{name}</Text>
                {handle ? <Text className="text-muted dark:text-muted-dark">@{handle}</Text> : null}
              </View>
              <Icon name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? palette.primary : palette.muted} />
            </Pressable>
          );
        }}
      />
      <View className="gap-2 border-t border-border p-4 dark:border-border-dark">
        <ErrorText>{error}</ErrorText>
        <Button label={group ? `Add ${picked.length || ''}`.trim() : picked.length > 1 ? 'Start group chat' : 'Start chat'} disabled={!picked.length} loading={busy} onPress={go} />
      </View>
    </View>
  );
}
