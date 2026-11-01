import { render, screen } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';

import { TABS, visibleTabs } from '@/app/(drawer)/(tabs)/_layout';
import HomeScreen from '@/app/(drawer)/(tabs)/index';
import { MessagesScreen } from '@/app/(drawer)/(tabs)/messages';
import { DRAWER_ITEMS } from '@/components/app-drawer';

// Jest hoists this above the imports; Home reads the session.
const mockSession = { status: 'signedIn', account: { userId: 'u', handle: 'me' } };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useNavigation: () => ({ dispatch: jest.fn() }),
  useFocusEffect: (cb: () => void) => mockUseEffect(cb, [cb]),
}));
jest.mock('@/lib/addressbook', () => ({ loadAddressBook: async () => ({ v: 1, myEpochs: [], contacts: {} }) }));
jest.mock('@/lib/circles', () => ({ resumePendingRotation: async () => false, labelOf: () => '' }));
// Post cards use Reanimated and the media pipeline uses native modules; neither loads under jest-expo.
jest.mock('@/components/post-card', () => ({ PostCard: () => null, OutboxCard: () => null }));
jest.mock('@/lib/posts', () => ({}));
jest.mock('@/lib/outbox', () => ({ useOutbox: () => [] }));
jest.mock('@/lib/background-check', () => ({ offerBackgroundChecksNow: async () => false, onNotificationOpened: () => () => {}, markActiveNow: async () => {} }));
jest.mock('@/lib/activity', () => ({ refreshActivity: async () => {}, useActivity: () => ({ items: null, unseen: 0 }) }));
jest.mock('@/lib/security-events', () => ({ newSignIns: async () => [] }));
jest.mock('@/lib/messaging', () => ({ useConversations: () => [], syncMessaging: async () => {}, unreadCount: () => 0 }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  useSharedValue: (v: number) => ({ value: v }),
  useAnimatedStyle: () => ({}),
  withTiming: (v: number) => v,
}));
jest.mock('@shopify/flash-list', () => ({ FlashList: jest.requireActual('react-native').FlatList }));
jest.mock('@/components/post-actions', () => ({ usePostActions: () => ({ cardProps: () => ({}), sheet: null }) }));
jest.mock('@/lib/feed-store', () => ({
  useFeed: () => ({ posts: [], ids: [], pending: [], refreshing: false, loading: false, hasMore: false, loaded: true }),
  refreshFeed: async () => {},
  loadMoreFeed: async () => {},
  checkForNewPosts: async () => {},
  showPendingPosts: () => {},
}));

// The full drawer + tabs navigator needs Reanimated's native runtime, which doesn't load under jest-expo;
// it is checked on the emulator (docs/PROGRESS.md "Needs manual check").
describe('app shell', () => {
  it('has the icon-only tabs from PLAN.md 2A, each with a screen-reader label; Messages only while chat is on', () => {
    // Chat is hidden for now (owner decision 2026-11-01): Circlo is about posts in circles.
    expect(TABS.map((t) => t.label)).toEqual(['Home', 'People', 'Notifications']);
    expect(visibleTabs(true).map((t) => t.label)).toEqual(['Home', 'People', 'Notifications', 'Messages']);
    for (const t of visibleTabs(true)) {
      expect(t.icon).toBeTruthy();
      expect(t.iconActive).toBeTruthy();
    }
  });

  it('drawer has Profile, Circles, Devices and Settings', () => {
    expect(DRAWER_ITEMS.map((i) => i.label)).toEqual(['Profile', 'Circles', 'Devices', 'Settings']);
  });

  it('Home shows the empty state and a labelled compose button', async () => {
    await render(<HomeScreen />);
    expect(await screen.findByText('Your timeline is quiet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite your first person' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compose post' })).toBeTruthy();
  });

  it('Messages has a labelled new-message button', async () => {
    await render(<MessagesScreen />);
    expect(screen.getByRole('button', { name: 'New message' })).toBeTruthy();
  });

  it('never shows a circle number to readers', async () => {
    await render(<MessagesScreen />);
    expect(screen.queryByText(/circle \d+/i)).toBeNull();
  });
});
