import { Icon, type IconName } from '@/components/ui/icon';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-surface dark:bg-surface-dark">
    <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4">
      <View className="gap-1 border-b border-border pb-4 dark:border-border-dark">
        <Avatar size="lg" name={handle} />
        <Text className="mt-2 text-[17px] font-extrabold text-ink dark:text-ink-dark">@{handle}</Text>
        <Text className="text-muted dark:text-muted-dark">End-to-end encrypted</Text>
      </View>
      {items.map((item) => (
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
