import { unseenCount, type ActivityItem } from '@/lib/activity';
import { mergeRows } from '@/app/(tabs)/notifications';

jest.mock('@circlo/core', () => ({}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('@/api/client', () => ({}));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedOut' }) }));
jest.mock('@/lib/posts', () => ({}));
jest.mock('@/components/post-actions', () => ({}));
jest.mock('@/lib/background-check', () => ({}));

const item = (createdAt: string, kind: ActivityItem['kind'] = 'like'): ActivityItem => ({ kind, postId: 'p1', actorId: 'a1', createdAt });

describe('activity', () => {
  it('counts what is newer than the seen time for the bell dot', () => {
    const items = [item('2026-10-30T12:00:00Z'), item('2026-10-30T11:00:00.5Z'), item('2026-10-30T10:00:00Z')];
    expect(unseenCount(items, '2026-10-30T11:00:00Z')).toBe(2);
    expect(unseenCount(items, '2026-10-30T12:00:00.000Z')).toBe(0);
    expect(unseenCount(null, '2026-10-30T11:00:00Z')).toBe(0);
    expect(unseenCount(items, null)).toBe(0); // not loaded yet: no flashing dot
  });

  it('lists replies, likes and sign-ins together, newest first', () => {
    const rows = mergeRows([item('2026-10-30T12:00:00Z', 'reply'), item('2026-10-30T10:00:00Z')], [{ id: 's1', createdAt: '2026-10-30T11:00:00Z' }]);
    expect(rows.map((r) => r.type)).toEqual(['activity', 'signIn', 'activity']);
  });
});
