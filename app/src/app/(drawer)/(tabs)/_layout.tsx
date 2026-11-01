import { Tabs } from 'expo-router';

import { DrawerAvatarButton, HeaderBar } from '@/components/ui/header';
import { TabBar, type TabSpec } from '@/components/ui/tab-bar';
import { useActivity } from '@/lib/activity';
import { hasUnreadChats, useBlocked } from '@/lib/blocks';
import { useConversations } from '@/lib/messaging';
import { useConnectionsSync, useHasUnseenRequests } from '@/lib/use-connections';

export const TABS: TabSpec[] = [
  { name: 'index', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { name: 'search', label: 'People', icon: 'people-outline', iconActive: 'people' },
  { name: 'notifications', label: 'Notifications', icon: 'notifications-outline', iconActive: 'notifications' },
  { name: 'messages', label: 'Messages', icon: 'mail-outline', iconActive: 'mail' },
];

/** Bottom tab bar with icons only (PLAN.md 2A). Labels exist for screen readers. Same on iOS and Android. */
export default function TabLayout() {
  useConnectionsSync();
  const unseenRequests = useHasUnseenRequests();
  const activity = useActivity();
  const unreadChats = hasUnreadChats(useConversations(), useBlocked());
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} tabs={TABS} dots={{ notifications: unseenRequests || activity.unseen > 0, messages: unreadChats }} />}
      screenOptions={{ header: ({ options }) => <HeaderBar title={options.title} left={<DrawerAvatarButton />} /> }}>
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.label,
            // Home draws its own header so it can hide on scroll (PLAN.md 2A).
            ...(t.name === 'index' ? { headerShown: false } : {}),
          }}
        />
      ))}
    </Tabs>
  );
}
