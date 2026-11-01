import { Tabs } from 'expo-router';

import { DrawerAvatarButton, HeaderBar } from '@/components/ui/header';
import { TabBar, type TabSpec } from '@/components/ui/tab-bar';
import { CHAT_ENABLED } from '@/lib/features';
import { useActivity } from '@/lib/activity';
import { hasUnreadChats, useBlocked } from '@/lib/blocks';
import { useConversations } from '@/lib/messaging';
import { useConnectionsSync, useHasUnseenRequests } from '@/lib/use-connections';

const ALL_TABS: TabSpec[] = [
  { name: 'index', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { name: 'search', label: 'People', icon: 'people-outline', iconActive: 'people' },
  { name: 'notifications', label: 'Notifications', icon: 'notifications-outline', iconActive: 'notifications' },
  { name: 'messages', label: 'Messages', icon: 'mail-outline', iconActive: 'mail' },
];

/** Pure: the tabs shown. Messages only while chat is enabled (lib/features). Exported for tests. */
export function visibleTabs(chat: boolean): TabSpec[] {
  return chat ? ALL_TABS : ALL_TABS.filter((t) => t.name !== 'messages');
}

export const TABS = visibleTabs(CHAT_ENABLED);

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
      {ALL_TABS.map((t) => (
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
