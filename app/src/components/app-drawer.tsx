import Ionicons from '@expo/vector-icons/Ionicons';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

import { Avatar } from './avatar';

type Item = { label: string; icon: ComponentProps<typeof Ionicons>['name']; href: Href };

export const DRAWER_ITEMS: Item[] = [
  { label: 'Profile', icon: 'person-outline', href: '/profile' },
  { label: 'Circles', icon: 'radio-button-on-outline', href: '/circles' },
  { label: 'Devices', icon: 'phone-portrait-outline', href: '/devices' },
  { label: 'Settings', icon: 'settings-outline', href: '/settings' },
  { label: 'Recovery phrase', icon: 'key-outline', href: '/recovery' },
];

/** Side drawer opened from the Home avatar (PLAN.md 2A app shell). */
export function AppDrawer({ navigation }: DrawerContentComponentProps) {
  const palette = usePalette();
  const session = useSession();
  const handle = session.status === 'signedIn' ? session.account.handle : '';
  const go = (href: Href) => {
    navigation.closeDrawer();
    router.push(href);
  };
  const items = __DEV__ ? [...DRAWER_ITEMS, { label: 'Crypto self-test', icon: 'flask-outline', href: '/dev' } as Item] : DRAWER_ITEMS;

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="px-5 pt-safe-offset-4">
      <View className="gap-1 border-b border-border pb-4 dark:border-border-dark">
        <Avatar size="lg" name={handle} />
        <Text className="mt-2 text-lg font-bold text-ink dark:text-ink-dark">@{handle}</Text>
        <Text className="text-muted dark:text-muted-dark">End-to-end encrypted</Text>
      </View>
      {items.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="button"
          onPress={() => go(item.href)}
          className="flex-row items-center gap-4 py-4 active:opacity-60">
          <Ionicons name={item.icon} size={24} color={palette.ink} />
          <Text className="text-lg font-semibold text-ink dark:text-ink-dark">{item.label}</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          navigation.closeDrawer();
          void session.signOut();
        }}
        className="flex-row items-center gap-4 border-t border-border py-4 dark:border-border-dark">
        <Ionicons name="log-out-outline" size={24} color={palette.danger} />
        <Text className="text-lg font-semibold text-danger dark:text-danger-dark">Log out</Text>
      </Pressable>
    </ScrollView>
  );
}
