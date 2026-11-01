import { activityHref, activityVerb } from '@/app/(drawer)/(tabs)/notifications';
import type { ActivityItem } from '@/lib/activity';
import { isChange } from '@/lib/live';
import { pushRoute } from '@/lib/push-route';
import { reportBody } from '@/lib/report';
import { fromReplyRow, toggledReplyLike } from '@/lib/thread';

jest.mock('@/api/client', () => ({ api: {} }));
jest.mock('@/lib/storage', () => ({}));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedOut' }) }));
jest.mock('@/lib/posts', () => ({ fromRow: jest.fn() }));
jest.mock('@/components/post-actions', () => ({}));
jest.mock('@/lib/background-check', () => ({}));

const P = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('tapping a push', () => {
  it('opens the reply, the chat or the requests', () => {
    expect(pushRoute({ type: 'reply', postId: P, replyId: R })).toEqual({ pathname: '/post/[id]', params: { id: P, reply: R } });
    expect(pushRoute({ type: 'message', chatId: C })).toEqual({ pathname: '/chat/[id]', params: { id: C } });
    expect(pushRoute({ type: 'request' })).toEqual({ pathname: '/search', params: { section: 'friends' } });
  });

  it('falls back to Notifications for counts-only or malformed data', () => {
    expect(pushRoute({})).toBe('/notifications');
    expect(pushRoute(null)).toBe('/notifications');
    expect(pushRoute({ type: 'reply', postId: '../settings', replyId: R })).toBe('/notifications');
    expect(pushRoute({ type: 'message', chatId: 42 })).toBe('/notifications');
  });
});

describe('live updates', () => {
  it('treats the first answer as where we are, and any new version as a change', () => {
    expect(isChange(null, 1000)).toBe(false);
    expect(isChange(1000, 1000)).toBe(false);
    expect(isChange(1000, 1001)).toBe(true);
    expect(isChange(5000, 1200)).toBe(true); // server restarted
  });
});

describe('reply likes', () => {
  const row = {
    replyId: R,
    authorId: 'a',
    author: { userId: 'a', name: 'Ana', username: 'ana', avatarUrl: null },
    text: 'hi',
    createdAt: '2026-11-01T00:00:00Z',
    likeCount: 2,
    likedByMe: false,
  };

  it('reads like counts from the server', () => {
    expect(fromReplyRow(row as never, 'me')).toMatchObject({ likeCount: 2, likedByMe: false, mine: false });
  });

  it('toggles optimistically and never goes below zero', () => {
    const r = fromReplyRow(row as never, 'me');
    expect(toggledReplyLike(r)).toMatchObject({ likedByMe: true, likeCount: 3 });
    expect(toggledReplyLike({ ...r, likedByMe: true, likeCount: 0 })).toMatchObject({ likedByMe: false, likeCount: 0 });
  });

  it('a like on my reply opens the thread at that reply', () => {
    const item = { kind: 'reply_like', postId: P, replyId: R, postText: '', actorId: 'b', actorName: 'Bo', actorHandle: 'bo', createdAt: '' } as ActivityItem;
    expect(activityHref(item)).toEqual({ pathname: '/post/[id]', params: { id: P, reply: R } });
    expect(activityVerb('reply_like')).toBe(' liked your reply');
    expect(activityVerb('reply')).toBe(' replied to your post');
    expect(activityVerb('like')).toBe(' liked your post');
  });

  it('replies can be reported', () => {
    expect(reportBody('reply', R, 'harassment', '')).toEqual({ kind: 'reply', targetId: R, reason: 'harassment' });
  });
});
