import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';

import { CirclesList } from '@/components/circles-list';
import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { describeError } from '@/lib/account';
import { refreshAddressBook, type AddressBook } from '@/lib/addressbook';
import { useSession } from '@/lib/session';

/**
 * My Circles on its own screen (for links such as circlo://circles). The same list lives in the People tab's Circles
 * section, which is where the app leads people now.
 */
export default function CirclesScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const [book, setBook] = useState<AddressBook | null>(null);
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      if (!account) return;
      refreshAddressBook(account)
        .then(setBook)
        .catch((e) => setError(describeError(e)));
    }, [account]),
  );

  if (!account || !book) return <Screen>{error ? <ErrorText>{error}</ErrorText> : null}</Screen>;
  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-2 p-4">
        <ErrorText>{error}</ErrorText>
        <CirclesList book={book} />
      </ScrollView>
    </Screen>
  );
}
