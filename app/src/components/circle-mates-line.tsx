import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Text } from '@/components/ui/text';
import { loadCircleMates, matesLine, type CircleMate } from '@/lib/circle-mates';

/**
 * On a friend's profile, X's "Followed by…" line for the people I may know through them: up to three photos and their
 * names, opening the full list. Nothing at all when there's nobody (or the friend switched it off). Never a circle.
 */
export function CircleMatesLine({ ownerId, ownerName }: { ownerId: string; ownerName: string }) {
  const [mates, setMates] = useState<CircleMate[]>([]);
  useFocusEffect(
    useCallback(() => {
      loadCircleMates(ownerId).then(setMates, () => setMates([]));
    }, [ownerId]),
  );
  if (mates.length === 0) return null;
  const names = matesLine(mates.map((m) => m.name));
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`People you may know through ${ownerName}: ${names}`}
      onPress={() => router.push({ pathname: '/mates/[id]', params: { id: ownerId } })}
      className="flex-row items-center gap-2 py-1 active:opacity-60">
      <View className="flex-row">
        {mates.slice(0, 3).map((m, i) => (
          <View key={m.userId} className={`rounded-full border-2 border-surface dark:border-surface-dark ${i > 0 ? '-ml-2' : ''}`}>
            <Avatar size="sm" id={m.userId} name={m.name} uri={m.avatarUrl} />
          </View>
        ))}
      </View>
      <Text numberOfLines={2} className="flex-1 text-sm text-muted dark:text-muted-dark">
        You may know <Text className="text-sm font-semibold text-ink dark:text-ink-dark">{names}</Text> through {ownerName}
      </Text>
    </Pressable>
  );
}
