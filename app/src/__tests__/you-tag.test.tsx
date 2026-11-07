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

describe('my own posts and replies say "(you)"', () => {
  it('marks my post in the timeline in place of my own handle', async () => {
    await render(<PostCard post={post(true)} name="Zaheer" handle="zaheer" />);
    expect(screen.getByText('(you)')).toBeTruthy();
    expect(screen.queryByText('@zaheer')).toBeNull();
  });

  it('marks my post in the thread, with my handle on its own line below', async () => {
    await render(<PostDetail post={post(true)} name="Zaheer" handle="zaheer" />);
    expect(screen.getByText('(you)')).toBeTruthy();
    expect(screen.getByText('@zaheer')).toBeTruthy();
  });

  it("doesn't mark other people's posts", async () => {
    await render(<PostCard post={post(false)} name="Maira" handle="maira" />);
    expect(screen.queryByText('(you)')).toBeNull();
    expect(screen.getByText('@maira')).toBeTruthy();
    await render(<PostDetail post={post(false)} name="Maira" handle="maira" />);
    expect(screen.queryByText('(you)')).toBeNull();
  });

  it('can leave it out where every post is mine (my own profile)', async () => {
    await render(<PostCard post={post(true)} name="Zaheer" handle="zaheer" hideYou />);
    expect(screen.queryByText('(you)')).toBeNull();
    expect(screen.getByText('@zaheer')).toBeTruthy();
  });

  it('the tag on its own, for reply rows', async () => {
    await render(<YouTag />);
    expect(screen.getByText('(you)')).toBeTruthy();
  });
});
