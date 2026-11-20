import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  dismissedMayKnow,
  dismissMayKnow,
  loadPeopleYouMayKnow,
  matesLine,
  showMayKnow,
  type MayKnowGroup,
} from '@/lib/circle-mates';
import { usePalette } from '@/theme/use-palette';

const MAX_GROUPS = 3;

/**
 * Home's "People you may know" (owner request 2026-11-20): the people in my friends' circles that I'm not connected
 * with yet, one line per friend, each opening that friend's list where I can connect. The same people as on their
 * profiles, never which circle. Closing it hides it on this device until someone new is listed. No push.
 */
export function PeopleYouMayKnow({ userId }: { userId: string }) {
  const palette = usePalette();
  const [groups, setGroups] = useState<MayKnowGroup[]>([]);
  const [dismissed, setDismissed] = useState<Set<string> | null>(null);

  useFocusEffect(
    useCallback(() => {
      dismissedMayKnow(userId).then(setDismissed);
      loadPeopleYouMayKnow().then(setGroups, () => setGroups([]));
    }, [userId]),
  );

  if (!dismissed || !showMayKnow(groups, dismissed)) return null;
  const shown = groups.slice(0, MAX_GROUPS);
  const more = groups.length - shown.length;

  return (
    <View className="mx-4 my-3 gap-3 rounded-2xl border border-border p-4 dark:border-border-dark">
      <View className="flex-row items-center justify-between">
        <Text accessibilityRole="header" className="text-lg font-extrabold text-ink dark:text-ink-dark">
          People you may know
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close People you may know"
          hitSlop={8}
          onPress={() => dismissMayKnow(userId, groups, dismissed).then(setDismissed)}
          className="active:opacity-60">
          <Icon name="close" size={20} color={palette.muted} />
        </Pressable>
      </View>
      {shown.map((g) => {
        const names = matesLine(g.people.map((p) => p.name));
        return (
          <Pressable
            key={g.owner.userId}
            accessibilityRole="link"
            accessibilityLabel={`You may know ${names} through ${g.owner.name}`}
            onPress={() => router.push({ pathname: '/mates/[id]', params: { id: g.owner.userId } })}
            className="flex-row items-center gap-3 active:opacity-60">
            <View className="flex-row">
              {g.people.slice(0, 3).map((p, i) => (
                <View key={p.userId} className={`rounded-full border-2 border-surface dark:border-surface-dark ${i > 0 ? '-ml-3' : ''}`}>
                  <Avatar size="md" id={p.userId} name={p.name} uri={p.avatarUrl} />
                </View>
              ))}
            </View>
            <Text numberOfLines={2} className="flex-1 text-sm text-muted dark:text-muted-dark">
              You may know <Text className="text-sm font-semibold text-ink dark:text-ink-dark">{names}</Text> through {g.owner.name}
            </Text>
            <Icon name="chevron-forward" size={18} color={palette.muted} />
          </Pressable>
        );
      })}
      {more > 0 ? (
        <Text className="text-sm text-muted dark:text-muted-dark">
          And more through {more} other {more === 1 ? 'friend' : 'friends'}: see their profiles.
        </Text>
      ) : null}
    </View>
  );
}
