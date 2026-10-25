import { Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Screen } from '@/components/screen';
import { fingerprint } from '@/lib/account';
import { hexGroups } from '@/lib/bytes';
import { useSession } from '@/lib/session';

export default function ProfileScreen() {
  const session = useSession();
  if (session.status !== 'signedIn') return null;
  const { account } = session;
  return (
    <Screen>
      <View className="items-center gap-3 px-6 pt-8">
        <Avatar size="lg" name={account.handle} />
        <Text className="text-2xl font-bold text-ink dark:text-ink-dark">@{account.handle}</Text>
        <Text className="text-center text-muted dark:text-muted-dark">
          Your display name, bio and photo will be encrypted so only friends can see them.
        </Text>
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
