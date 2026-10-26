import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/form';
import { Screen } from '@/components/screen';
import { fingerprint } from '@/lib/account';
import { hexGroups } from '@/lib/bytes';
import { loadMyProfile, type Profile } from '@/lib/friends';
import { useSession } from '@/lib/session';

export default function ProfileScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const [profile, setProfile] = useState<Profile | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (account) void loadMyProfile(account).then(setProfile, () => setProfile(null));
    }, [account]),
  );

  if (!account) return null;
  const name = profile?.displayName || account.handle;
  return (
    <Screen>
      <View className="items-center gap-3 px-6 pt-8">
        <Avatar size="lg" name={name} />
        <Text className="text-2xl font-bold text-ink dark:text-ink-dark">{name}</Text>
        <Text className="text-muted dark:text-muted-dark">@{account.handle}</Text>
        {profile?.bio ? <Text className="text-center text-base text-ink dark:text-ink-dark">{profile.bio}</Text> : null}
        <Text className="text-center text-sm text-muted dark:text-muted-dark">
          Your name and bio are encrypted so only your friends can see them.
        </Text>
        <View className="w-full">
          <Button label="Edit profile" variant="outline" onPress={() => router.push('/edit-profile')} />
        </View>
        <View className="mt-4 w-full gap-1 rounded-xl border border-border p-4 dark:border-border-dark">
          <Text className="text-sm font-semibold text-muted dark:text-muted-dark">Identity fingerprint</Text>
          <Text selectable className="font-mono text-base text-ink dark:text-ink-dark" accessibilityLabel="Identity fingerprint">
            {hexGroups(fingerprint(account))}
          </Text>
          <Text className="text-sm text-muted dark:text-muted-dark">The same on every device you log in to.</Text>
        </View>
      </View>
    </Screen>
  );
}
