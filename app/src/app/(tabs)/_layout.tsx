import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { HomeHeader } from '@/components/home-header';
import { usePalette } from '@/theme/use-palette';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const TABS: { name: string; label: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { name: 'search', label: 'Search', icon: 'search-outline', iconActive: 'search' },
  { name: 'notifications', label: 'Notifications', icon: 'notifications-outline', iconActive: 'notifications' },
  { name: 'messages', label: 'Messages', icon: 'mail-outline', iconActive: 'mail' },
];

/** Bottom tab bar with icons only (PLAN.md 2A). Labels exist for screen readers. */
export default function TabLayout() {
  const palette = usePalette();
  return (
    <Tabs
      screenOptions={{
        tabBarShowLabel: false,
        tabBarActiveTintColor: palette.ink,
        tabBarInactiveTintColor: palette.muted,
        headerTitleAlign: 'center',
        headerTintColor: palette.ink,
      }}>
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.label,
            tabBarAccessibilityLabel: t.label,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons name={focused ? t.iconActive : t.icon} size={26} color={String(color)} />
            ),
            ...(t.name === 'index' ? { header: () => <HomeHeader /> } : {}),
          }}
        />
      ))}
    </Tabs>
  );
}
