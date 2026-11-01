import { render, renderHook, screen, within } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { activityHref } from '@/app/(drawer)/(tabs)/notifications';
import { AppDrawer } from '@/components/app-drawer';
import type { ActivityItem } from '@/lib/activity';
import { hasUnreadChats } from '@/lib/blocks';
import type { Conversation } from '@/lib/messaging';
import { useConnectionsSync } from '@/lib/use-connections';

const mockSession = { status: 'signedIn', account: { userId: 'me', handle: 'me' }, signOut: jest.fn() };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('@/api/client', () => ({}));
jest.mock('@/lib/addressbook', () => ({}));
jest.mock('@/lib/storage', () => ({ getItem: async () => null, setItem: async () => {}, deleteItem: async () => {} }));
jest.mock('@/lib/friends', () => ({ syncConnections: jest.fn(async () => []) }));
jest.mock('@/lib/activity', () => ({ refreshActivity: jest.fn(async () => {}) }));
jest.mock('@/lib/background-check', () => ({ markActiveNow: async () => {}, refreshPushToken: async () => {} }));
const mockStartLive = jest.fn(() => () => {});
jest.mock('@/lib/live', () => ({ startLive: (...a: unknown[]) => mockStartLive(...(a as [])), onLiveChange: () => () => {} }));
jest.mock('@/lib/me', () => ({ useMe: () => null, refreshMe: async () => {} }));
jest.mock('@/lib/posts', () => ({}));
jest.mock('@/components/post-actions', () => ({}));
const mockSyncMessaging = jest.fn(async (_account: unknown) => {});
jest.mock('@/lib/messaging', () => ({ syncMessaging: (account: unknown) => mockSyncMessaging(account) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() }, useFocusEffect: jest.fn() }));

const conv = (groupId: string, members: string[], unread: number, active = true): Conversation =>
  ({ groupId, members, people: {}, messages: [], readSeq: 0, unread, active, updatedAtMs: 0 }) as Conversation;

describe('Messages tab dot', () => {
  it('shows when a chat has unread messages', () => {
    expect(hasUnreadChats([conv('a', ['x'], 0), conv('b', ['y'], 2)], new Set())).toBe(true);
    expect(hasUnreadChats([conv('a', ['x'], 0)], new Set())).toBe(false);
  });

  it('ignores chats I left and chats with only blocked people', () => {
    expect(hasUnreadChats([conv('a', ['x'], 3, false)], new Set())).toBe(false);
    expect(hasUnreadChats([conv('a', ['bad'], 3)], new Set(['bad']))).toBe(false);
  });

  it('keeps the inbox fresh while the app is open, not only on the Messages tab', async () => {
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    await renderHook(() => useConnectionsSync());
    expect(mockSyncMessaging).toHaveBeenCalledWith(mockSession.account);
    // ...and listens for live updates, so dots appear the moment something happens.
    expect(mockStartLive).toHaveBeenCalled();
  });
});

describe('Notification taps', () => {
  const item = (kind: ActivityItem['kind'], replyId?: string): ActivityItem =>
    ({ kind, postId: 'p1', postText: '', actorId: 'a', actorName: 'Ana', actorHandle: 'ana', replyId, createdAt: '2026-11-01T00:00:00Z' });

  it('open the reply itself for a reply', () => {
    expect(activityHref(item('reply', 'r9'))).toEqual({ pathname: '/post/[id]', params: { id: 'p1', reply: 'r9' } });
  });

  it('open the post for a like', () => {
    expect(activityHref(item('like'))).toEqual({ pathname: '/post/[id]', params: { id: 'p1' } });
  });
});

describe('drawer', () => {
  it('keeps Log out apart from the menu, pinned at the bottom', async () => {
    const props = { navigation: { closeDrawer: jest.fn() }, state: { history: [] } } as unknown as Parameters<typeof AppDrawer>[0];
    await render(<AppDrawer {...props} />);
    const menu = screen.getByTestId('drawer-menu');
    expect(within(menu).getByText('Settings')).toBeTruthy();
    expect(within(menu).queryByText('Log out')).toBeNull();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
  });
});
