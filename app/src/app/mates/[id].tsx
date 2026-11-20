import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorText } from '@/components/form';
import { PersonRow, RowButton } from '@/components/person-row';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { loadAddressBook } from '@/lib/addressbook';
import { loadCircleMates, type CircleMate } from '@/lib/circle-mates';
import { sendRequest } from '@/lib/friends';
import { useSession } from '@/lib/session';
import { showToast } from '@/lib/toast';

/**
 * The people I may know through a friend (owner decision 2026-11-20): the others in their circles that I'm in too,
 * where they let people see each other. One list sorted by name; nobody sees which circle. I can ask anyone I'm not
 * connected with to connect; they're in my Everyone until I choose circles for them.
 */
export default function MatesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const navigation = useNavigation();
  const [owner, setOwner] = useState('them');
  const [mates, setMates] = useState<CircleMate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    if (!account) return;
    loadAddressBook(account).then((b) => {
      const name = b.contacts[id]?.displayName;
      if (name) {
        setOwner(name);
        navigation.setOptions({ title: `Through ${name}` });
      }
    }, () => {});
    loadCircleMates(id).then(setMates, (e) => {
      setMates([]);
      setError(describeError(e));
    });
  }, [account, id, navigation]);
  useFocusEffect(load);

  if (!account) return null;
  if (mates === null) return <Spinner className="flex-1 bg-surface py-10 dark:bg-surface-dark" />;

  const connect = async (m: CircleMate) => {
    setBusy(m.userId);
    setError(undefined);
    try {
      await sendRequest(account, m.userId);
      showToast(`Request sent to ${m.name}`);
      setMates((all) => all?.map((x) => (x.userId === m.userId ? { ...x, relation: 'outgoing' } : x)) ?? null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };
  const profile = (userId: string) => () => router.push({ pathname: '/friend/[id]', params: { id: userId } });

  const action = (m: CircleMate) => {
    if (m.relation === 'accepted') return undefined;
    if (m.relation === 'outgoing') return <RowButton label="Requested" accessibilityLabel={`Request sent to ${m.name}`} disabled onPress={() => {}} />;
    if (m.relation === 'incoming') return <RowButton label="Respond" accessibilityLabel={`Respond to ${m.name}`} filled onPress={profile(m.userId)} />;
    return (
      <RowButton
        label="Connect"
        accessibilityLabel={`Connect with ${m.name}`}
        filled
        busy={busy === m.userId}
        disabled={!!busy}
        onPress={() => void connect(m)}
      />
    );
  };

  if (mates.length === 0) {
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark">
        <EmptyState icon="people-outline" title="Nobody here yet" body={`When ${owner} puts you in a circle with other people, you’ll see them here.`} />
        <View className="px-5">
          <ErrorText>{error}</ErrorText>
        </View>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="px-5 pb-10 pt-3">
      <Text className="pb-1 text-muted dark:text-muted-dark">
        {owner} has put you in the same circle as these people. Nobody sees which circle.
      </Text>
      <ErrorText>{error}</ErrorText>
      {mates.map((m) => (
        <PersonRow
          key={m.userId}
          id={m.userId}
          name={m.name}
          handle={m.username}
          avatarUrl={m.avatarUrl}
          // Their profile opens once we're connected (or one of us has asked), as everywhere else.
          onPress={m.relation ? profile(m.userId) : undefined}
          action={action(m)}
        />
      ))}
    </ScrollView>
  );
}
