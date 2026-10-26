import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/form';
import { Screen } from '@/components/screen';
import { displayName, useConnections } from '@/lib/use-connections';
import { usePalette } from '@/theme/use-palette';

/** A friend's profile, decrypted on this device. Readers never see any circle label (PLAN.md 2A). */
export default function FriendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const { connections } = useConnections();
  const c = connections?.find((x) => x.userId === id);
  if (!c) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <View className="items-center gap-3 px-6 pt-8">
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
            <Ionicons
              name={c.verified ? 'shield-checkmark' : 'shield-outline'}
              size={20}
              color={c.verified ? palette.primary : palette.muted}
            />
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
      </View>
    </Screen>
  );
}
