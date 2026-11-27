import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect as mockUseEffect } from 'react';

import { TABS, visibleTabs } from '@/app/(drawer)/(tabs)/_layout';
import HomeScreen from '@/app/(drawer)/(tabs)/index';
import { MessagesScreen } from '@/app/(drawer)/(tabs)/messages';
import { DRAWER_ITEMS } from '@/components/app-drawer';

// Jest hoists this above the imports; Home reads the session.
const mockSession = { status: 'signedIn', account: { userId: 'u', handle: 'me' } };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
const mockListeners: Record<string, () => void> = {};
let mockFocused = true;
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useNavigation: () => ({
    dispatch: jest.fn(),
    isFocused: () => mockFocused,
    addListener: (event: string, cb: () => void) => {
      mockListeners[event] = cb;
      return () => delete mockListeners[event];
    },
  }),
  useFocusEffect: (cb: () => void) => mockUseEffect(cb, [cb]),
}));
jest.mock('@/lib/addressbook', () => ({ loadAddressBook: async () => ({ v: 1, myEpochs: [], contacts: {} }) }));
jest.mock('@/lib/circles', () => ({ resumePendingRotation: async () => false, labelOf: () => '' }));
// Post cards use Reanimated and the media pipeline uses native modules; neither loads under jest-expo.
jest.mock('@/components/post-card', () => ({ PostCard: () => null, OutboxCard: () => null }));
jest.mock('@/components/people-you-may-know', () => ({ PeopleYouMayKnow: () => null }));
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
// FlatList stands in for FlashList; its ref offers the one method Home uses.
const mockScrollTo = jest.fn();
jest.mock('@shopify/flash-list', () => {
  const React = jest.requireActual('react');
  const { FlatList } = jest.requireActual('react-native');
  return {
    FlashList: React.forwardRef(function FlashList(props: object, ref: unknown) {
      React.useImperativeHandle(ref, () => ({ scrollToOffset: mockScrollTo }));
      return React.createElement(FlatList, props);
    }),
  };
});
jest.mock('@/components/post-actions', () => ({ usePostActions: () => ({ cardProps: () => ({}), sheet: null }) }));
jest.mock('@/lib/feed-store', () => ({
  useFeed: () => ({ posts: [], ids: [], pending: [], refreshing: false, loading: false, hasMore: false, loaded: true }),
  refreshFeed: async () => mockRefresh(),
  loadMoreFeed: async () => {},
  checkForNewPosts: async () => {},
  showPendingPosts: () => mockShowPending(),
}));
const mockShowPending = jest.fn();
const mockRefresh = jest.fn();

// The full drawer + tabs navigator needs Reanimated's native runtime, which doesn't load under jest-expo;
// it is checked on the emulator (docs/PROGRESS.md "Needs manual check").
describe('app shell', () => {
  it('has the icon-only tabs from PLAN.md 2A, each with a screen-reader label; Messages only while chat is on', () => {
    // Chat is on again (owner decision 2026-11-07).
    expect(TABS.map((t) => t.label)).toEqual(['Home', 'People', 'Notifications', 'Messages']);
    expect(visibleTabs(false).map((t) => t.label)).toEqual(['Home', 'People', 'Notifications']);
    expect(visibleTabs(true).map((t) => t.label)).toEqual(['Home', 'People', 'Notifications', 'Messages']);
    for (const t of visibleTabs(true)) {
      expect(t.icon).toBeTruthy();
      expect(t.iconActive).toBeTruthy();
    }
  });

  it('drawer has Profile, Feeds and Settings and privacy (circles live with your people, in the People tab)', () => {
    expect(DRAWER_ITEMS.map((i) => i.label)).toEqual(['Profile', 'Feeds', 'Todos', 'Settings and privacy']);
  });

  it('Home shows the empty state and a labelled compose button', async () => {
    await render(<HomeScreen />);
    expect(await screen.findByText('Get started')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compose post' })).toBeTruthy();
  });

  describe('tapping Home, like X', () => {
    beforeEach(() => {
      mockFocused = true;
      mockShowPending.mockClear();
      mockScrollTo.mockClear();
    });
    const tap = () => act(async () => mockListeners.tabPress());

    it('from another tab just switches to Home', async () => {
      await render(<HomeScreen />);
      await act(async () => undefined);
      mockFocused = false;
      mockRefresh.mockClear();
      await tap();
      expect(mockShowPending).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('on Home, scrolled down, goes back to the top without refreshing', async () => {
      await render(<HomeScreen />);
      await act(async () => undefined);
      await fireEvent.scroll(screen.getByTestId('home-feed'), { nativeEvent: { contentOffset: { y: 1200 } } });
      mockRefresh.mockClear();
      await tap();
      expect(mockScrollTo).toHaveBeenCalledWith({ offset: 0, animated: true });
      expect(mockRefresh).not.toHaveBeenCalled();
      expect(mockShowPending).not.toHaveBeenCalled();
    });

    it('on Home, at the top, refreshes the feed and shows new posts', async () => {
      await render(<HomeScreen />);
      await act(async () => undefined);
      mockRefresh.mockClear();
      await tap();
      expect(mockShowPending).toHaveBeenCalled();
      expect(mockRefresh).toHaveBeenCalled();
    });
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
