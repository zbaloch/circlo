import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Fab } from '@/components/fab';
import { Button } from '@/components/form';
import { ProfileFeed } from '@/components/profile-feed';
import { Screen } from '@/components/screen';
import { fingerprint } from '@/lib/account';
import { loadAddressBook } from '@/lib/addressbook';
import { hexGroups } from '@/lib/bytes';
import { loadMyProfile, type Profile } from '@/lib/friends';
import { useSession } from '@/lib/session';
import { Text } from '@/components/ui/text';

export default function ProfileScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<number>();

  useFocusEffect(
    useCallback(() => {
      if (!account) return;
      void loadMyProfile(account).then(setProfile, () => setProfile(null));
      void loadAddressBook(account).then((b) => setFriends(Object.keys(b.contacts).length), () => {});
    }, [account]),
  );

  if (!account) return null;
  return (
    <Screen>
      <ProfileFeed
        account={account}
        userId={account.userId}
        name={profile?.displayName || account.handle}
        handle={account.handle}
        bio={profile?.bio}
        friendCount={friends}
        actions={
          <View className="pt-2">
            <Button label="Edit profile" variant="outline" onPress={() => router.push('/edit-profile')} />
          </View>
        }
        extra={
          <View className="mt-3 gap-1 rounded-xl border border-border p-4 dark:border-border-dark">
            <Text className="text-sm font-semibold text-muted dark:text-muted-dark">Identity fingerprint</Text>
            <Text selectable className="font-mono text-base text-ink dark:text-ink-dark" accessibilityLabel="Identity fingerprint">
              {hexGroups(fingerprint(account))}
            </Text>
            <Text className="text-sm text-muted dark:text-muted-dark">
              The same on every device you log in to. Your name and bio are encrypted so only your friends can see them.
            </Text>
          </View>
        }
      />
      <Fab accessibilityLabel="Compose post" icon="add" onPress={() => router.push('/compose')} />
    </Screen>
  );
}
