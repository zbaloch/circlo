import { Icon, type IconName } from '@/components/ui/icon';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { refreshMe, useMe } from '@/lib/me';
import { readingHasNew } from '@/lib/reading';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

import { Avatar } from './avatar';
import { Text } from '@/components/ui/text';

type Item = { label: string; icon: IconName; href: Href; dot?: 'reading' };

export const DRAWER_ITEMS: Item[] = [
  { label: 'Profile', icon: 'person-outline', href: '/profile' },
  // Feeds (2.0; "reading" in code and the API, as /v1/feed is the timeline): web feeds. A quiet dot when something arrived since I last looked; no counts, no pushes.
  { label: 'Feeds', icon: 'rss-outline', href: '/feeds', dot: 'reading' },
  // Todos (2.0): my own to-do lists. Things-calm: no dot, no count.
  { label: 'Todos', icon: 'list-todo', href: '/todos' },
  // Devices is the first link inside Settings and privacy.
  { label: 'Settings and privacy', icon: 'settings-outline', href: '/settings' },
];

/** Side drawer opened from the Home avatar (PLAN.md 2A app shell). Log out sits apart at the bottom, away from the menu. */
export function AppDrawer({ navigation, state }: DrawerContentComponentProps) {
  const palette = usePalette();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const handle = account?.handle ?? '';
  const open = !!state.history?.some((h) => h.type === 'drawer');
  const me = useMe();
  const [readingNew, setReadingNew] = useState(false);
  useEffect(() => {
    if (!account || !open) return;
    refreshMe().catch(() => {});
    readingHasNew().then(setReadingNew, () => {});
  }, [account, open]);
  const displayName = me?.name || handle;
  const go = (href: Href) => {
    navigation.closeDrawer();
    router.push(href);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-surface dark:bg-surface-dark">
    <ScrollView testID="drawer-menu" className="flex-1" contentContainerClassName="px-5 pt-4">
      <View className="pb-2">
        <Avatar size="lg" id={account?.userId} name={displayName} uri={me?.avatarUrl} />
        <Text className="mt-3 text-xl font-extrabold text-ink dark:text-ink-dark">{displayName}</Text>
        <Text className="text-base text-muted dark:text-muted-dark">@{handle}</Text>
      </View>
      {DRAWER_ITEMS.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="button"
          accessibilityLabel={item.dot === 'reading' && readingNew ? `${item.label}, something new` : item.label}
          onPress={() => go(item.href)}
          className="flex-row items-center gap-4 py-4 active:opacity-60">
          <Icon name={item.icon} size={24} color={palette.ink} />
          <Text className="text-xl font-bold text-ink dark:text-ink-dark">{item.label}</Text>
          {item.dot === 'reading' && readingNew ? <View testID="reading-dot" className="h-2 w-2 rounded-full bg-primary dark:bg-primary-dark" /> : null}
        </Pressable>
      ))}
    </ScrollView>
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        navigation.closeDrawer();
        void session.signOut();
      }}
      className="mx-5 flex-row items-center gap-4 border-t border-border py-4 active:opacity-60 dark:border-border-dark">
      <Icon name="log-out-outline" size={24} color={palette.danger} />
      <Text className="text-xl font-bold text-danger dark:text-danger-dark">Log out</Text>
    </Pressable>
    </SafeAreaView>
  );
}
