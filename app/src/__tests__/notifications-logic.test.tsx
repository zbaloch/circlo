// Only pure helpers and the tab bar dot are tested here.
jest.mock('@/lib/background-check', () => ({ markActiveNow: async () => {} }));
jest.mock('@/lib/activity', () => ({ refreshActivity: async () => {} }));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedOut' }) }));

// eslint-disable-next-line import/first
import { render, screen } from '@testing-library/react-native';
// eslint-disable-next-line import/first
import { TabBar } from '@/components/ui/tab-bar';
// eslint-disable-next-line import/first
import type { Connection } from '@/lib/friends';
// eslint-disable-next-line import/first
import { unseenRequestIds } from '@/lib/use-connections';

const c = (userId: string, status: Connection['status']): Connection => ({ userId, status, profile: { displayName: userId, handle: userId, bio: '' } });

describe('unseen friend requests', () => {
  const connections = [c('a', 'incoming'), c('b', 'incoming'), c('c', 'outgoing'), c('d', 'accepted')];

  it('counts only incoming requests not seen yet', () => {
    expect(unseenRequestIds(connections, new Set(['a']))).toEqual(['b']);
    expect(unseenRequestIds(connections, new Set())).toEqual(['a', 'b']);
  });

  it('shows nothing until both lists have loaded, so the dot never flashes', () => {
    expect(unseenRequestIds(null, new Set())).toEqual([]);
    expect(unseenRequestIds(connections, null)).toEqual([]);
  });
});

describe('tab bar dot', () => {
  const tabs = [
    { name: 'index', label: 'Home', icon: 'home-outline', iconActive: 'home' },
    { name: 'notifications', label: 'Notifications', icon: 'notifications-outline', iconActive: 'notifications' },
  ] as const;
  const props = {
    state: { index: 0, routes: tabs.map((t) => ({ key: t.name, name: t.name })) },
    emitter: { emit: () => ({ defaultPrevented: false }) },
    navigateToTab: () => {},
    tabs: [...tabs],
  } as unknown as Parameters<typeof TabBar>[0];

  it('announces a tab with something new', async () => {
    await render(<TabBar {...props} dots={{ notifications: true }} />);
    expect(screen.getByLabelText('Notifications, new')).toBeTruthy();
    expect(screen.getByLabelText('Home')).toBeTruthy();
  });

  it('has no dot by default', async () => {
    await render(<TabBar {...props} />);
    expect(screen.getByLabelText('Notifications')).toBeTruthy();
  });
});
