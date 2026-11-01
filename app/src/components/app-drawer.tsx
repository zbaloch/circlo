import { Icon, type IconName } from '@/components/ui/icon';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { refreshMe, useMe } from '@/lib/me';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

import { Avatar } from './avatar';
import { Text } from '@/components/ui/text';

type Item = { label: string; icon: IconName; href: Href };

export const DRAWER_ITEMS: Item[] = [
  { label: 'Profile', icon: 'person-outline', href: '/profile' },
  { label: 'Circles', icon: 'radio-button-on-outline', href: '/circles' },
  { label: 'Devices', icon: 'phone-portrait-outline', href: '/devices' },
  { label: 'Settings', icon: 'settings-outline', href: '/settings' },
];

/** Side drawer opened from the Home avatar (PLAN.md 2A app shell). */
export function AppDrawer({ navigation, state }: DrawerContentComponentProps) {
  const palette = usePalette();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const handle = account?.handle ?? '';
  const open = !!state.history?.some((h) => h.type === 'drawer');
  const me = useMe();
  useEffect(() => {
    if (account && open) refreshMe().catch(() => {});
  }, [account, open]);
  const displayName = me?.name || handle;
  const go = (href: Href) => {
    navigation.closeDrawer();
    router.push(href);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-surface dark:bg-surface-dark">
    <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4">
      <View className="pb-2">
        <Avatar size="lg" id={account?.userId} name={displayName} uri={me?.avatarUrl} />
        <Text className="mt-3 text-xl font-extrabold text-ink dark:text-ink-dark">{displayName}</Text>
        <Text className="text-base text-muted dark:text-muted-dark">@{handle}</Text>
      </View>
      {DRAWER_ITEMS.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="button"
          onPress={() => go(item.href)}
          className="flex-row items-center gap-4 py-4 active:opacity-60">
          <Icon name={item.icon} size={24} color={palette.ink} />
          <Text className="text-xl font-bold text-ink dark:text-ink-dark">{item.label}</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          navigation.closeDrawer();
          void session.signOut();
        }}
        className="flex-row items-center gap-4 border-t border-border py-4 dark:border-border-dark">
        <Icon name="log-out-outline" size={24} color={palette.danger} />
        <Text className="text-xl font-bold text-danger dark:text-danger-dark">Log out</Text>
      </Pressable>
    </ScrollView>
    </SafeAreaView>
  );
}
