import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Fab } from '@/components/fab';
import { Button } from '@/components/form';
import { ProfileFeed } from '@/components/profile-feed';
import { Screen } from '@/components/screen';
import { loadAddressBook } from '@/lib/addressbook';
import { refreshMe, useMe } from '@/lib/me';
import { useSession } from '@/lib/session';

export default function ProfileScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const me = useMe();
  const [friends, setFriends] = useState<number>();

  useFocusEffect(
    useCallback(() => {
      if (!account) return;
      refreshMe().catch(() => {});
      void loadAddressBook(account).then((b) => setFriends(Object.values(b.contacts).filter((c) => c.status === 'accepted').length), () => {});
    }, [account]),
  );

  if (!account) return null;
  return (
    <Screen>
      <ProfileFeed
        account={account}
        userId={account.userId}
        name={me?.name || account.handle}
        handle={account.handle}
        bio={me?.bio}
        avatarUrl={me?.avatarUrl}
        friendCount={friends}
        actions={
          <View className="pt-2">
            <Button label="Edit profile" variant="outline" onPress={() => router.push('/edit-profile')} />
          </View>
        }
      />
      <Fab accessibilityLabel="Compose post" icon="add" onPress={() => router.push('/compose')} />
    </Screen>
  );
}
