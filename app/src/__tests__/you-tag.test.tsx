import { render, screen } from '@testing-library/react-native';

import { PostCard, PostDetail, YouTag } from '@/components/post-card';
import type { FeedPost } from '@/lib/posts';

jest.mock('@/components/post-media', () => ({ MediaGrid: () => null }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  useSharedValue: (v: number) => ({ value: v }),
  useAnimatedStyle: () => ({}),
  withTiming: (v: number) => v,
}));

const post = (mine: boolean): FeedPost => ({
  postId: 'p1',
  authorId: mine ? 'me' : 'maira',
  authorName: mine ? 'Zaheer' : 'Maira',
  authorHandle: mine ? 'zaheer' : 'maira',
  createdAtMs: Date.now(),
  text: 'hello',
  media: [],
  mine,
  replyCount: 0,
  likeCount: 0,
  likedByMe: false,
});

describe('my own posts and replies say "You"', () => {
  it('marks my post in the timeline and in the thread', async () => {
    await render(<PostCard post={post(true)} name="Zaheer" handle="zaheer" />);
    expect(screen.getByText('· You')).toBeTruthy();
    await render(<PostDetail post={post(true)} name="Zaheer" handle="zaheer" />);
    expect(screen.getByText('· You')).toBeTruthy();
  });

  it("doesn't mark other people's posts", async () => {
    await render(<PostCard post={post(false)} name="Maira" handle="maira" />);
    expect(screen.queryByText('· You')).toBeNull();
    await render(<PostDetail post={post(false)} name="Maira" handle="maira" />);
    expect(screen.queryByText('· You')).toBeNull();
  });

  it('can leave it out where every post is mine (my own profile)', async () => {
    await render(<PostCard post={post(true)} name="Zaheer" handle="zaheer" hideYou />);
    expect(screen.queryByText('· You')).toBeNull();
  });

  it('the tag on its own, for reply rows', async () => {
    await render(<YouTag />);
    expect(screen.getByText('· You')).toBeTruthy();
  });
});
