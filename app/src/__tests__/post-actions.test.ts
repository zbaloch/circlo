import { replyTarget } from '@/components/post-actions';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/api/client', () => ({}));

describe('a post’s reply icon', () => {
  it('opens the reply composer straight away when nobody has replied yet', () => {
    expect(replyTarget({ postId: 'p', replyCount: 0 })).toEqual({ pathname: '/reply/[id]', params: { id: 'p' } });
  });

  it('opens the thread first when there are replies to read', () => {
    expect(replyTarget({ postId: 'p', replyCount: 3 })).toEqual({ pathname: '/post/[id]', params: { id: 'p' } });
  });

  it('in the thread always opens the composer, which comes back to the thread', () => {
    const composer = { pathname: '/reply/[id]', params: { id: 'p', from: 'thread' } };
    expect(replyTarget({ postId: 'p', replyCount: 0 }, true)).toEqual(composer);
    expect(replyTarget({ postId: 'p', replyCount: 3 }, true)).toEqual(composer);
  });
});
