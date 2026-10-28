import { audienceBadge, authorName, visiblePosts } from '@/components/post-actions';
import { mergeIds } from '@/lib/feed-store';
import type { FeedPost } from '@/lib/posts';
import { toggledLike, validateReply } from '@/lib/thread';
import { likersLine, linkParts, postsForTab, profileTabs } from '@/lib/view-logic';

// Native modules and navigation don't load under jest; these tests cover the pure logic only.
jest.mock('@circlo/core', () => ({}));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-video-thumbnails', () => ({}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useFocusEffect: jest.fn(), useLocalSearchParams: () => ({}) }));

const post = (over: Partial<FeedPost> = {}): FeedPost => ({
  postId: 'p1',
  authorId: 'a',
  epochId: 'e',
  createdAtMs: 1,
  text: '',
  media: [],
  mine: false,
  postKey: new ArrayBuffer(32),
  readToken: new ArrayBuffer(32),
  replyCount: 0,
  likeCount: 0,
  likedByMe: false,
  ...over,
});

describe('circle labels', () => {
  const book = { labels: {} };
  it('shows the audience badge only on my own posts', () => {
    expect(audienceBadge(book, post({ mine: true, circle: 40 }))).toBe('Kids+');
    expect(audienceBadge(book, post({ mine: true, circle: 1 }))).toBe('Only me');
    // Close Friends is an exact audience: no "+".
    expect(audienceBadge(book, post({ mine: true, circle: 0 }))).toBe('Close Friends');
    // A friend's post never gets a badge, even if a circle somehow leaked into the object.
    expect(audienceBadge(book, post({ mine: false, circle: 7 }))).toBeUndefined();
    expect(audienceBadge(book, post({ mine: true }))).toBeUndefined();
  });
});

describe('author names and mutes', () => {
  const account = { userId: 'me', handle: 'zaheer' };
  const book = { contacts: { b: { displayName: 'Bob', handle: 'bob' } as never, c: { handle: 'carol' } as never }, muted: ['c'] };
  it('names me, friends by profile, and strangers neutrally', () => {
    expect(authorName(account, book, 'me').name).toBe('zaheer');
    expect(authorName(account, book, 'b')).toEqual({ name: 'Bob', handle: 'bob' });
    expect(authorName(account, book, 'c').name).toBe('@carol');
    expect(authorName(account, book, 'x').name).toBe('Friend');
  });
  it('hides muted authors locally', () => {
    const list = [post({ postId: '1', authorId: 'b' }), post({ postId: '2', authorId: 'c' })];
    expect(visiblePosts(book, list).map((p) => p.postId)).toEqual(['1']);
    expect(visiblePosts(null, list)).toHaveLength(2);
  });
});

describe('links', () => {
  it('linkifies only http(s) URLs and trims trailing punctuation', () => {
    expect(linkParts('see https://circlo.com/x, ok')).toEqual([{ text: 'see ' }, { text: 'https://circlo.com/x,', url: 'https://circlo.com/x' }, { text: ' ok' }]);
    expect(linkParts('javascript:alert(1) ftp://x')).toEqual([{ text: 'javascript:alert(1) ftp://x' }]);
  });
});

describe('likes and replies', () => {
  it('toggles likes optimistically', () => {
    const liked = toggledLike(post({ likeCount: 2 }));
    expect(liked).toMatchObject({ likedByMe: true, likeCount: 3 });
    expect(toggledLike(liked)).toMatchObject({ likedByMe: false, likeCount: 2 });
    expect(toggledLike(post({ likedByMe: true, likeCount: 0 })).likeCount).toBe(0);
  });
  it('names known likers and counts the rest', () => {
    expect(likersLine([], 0)).toBeNull();
    expect(likersLine([], 3)).toBe('Liked by 3 people');
    expect(likersLine(['Ana'], 0)).toBe('Liked by Ana');
    expect(likersLine(['Ana', 'Sam'], 0)).toBe('Liked by Ana and Sam');
    expect(likersLine(['Ana', 'Sam', 'Lee'], 2)).toBe('Liked by Ana, Sam and 3 others');
    expect(likersLine(['you'], 1)).toBe('Liked by you and 1 other');
  });
  it('validates replies', () => {
    expect(validateReply('   ')).not.toBeNull();
    expect(validateReply('hi')).toBeNull();
    expect(validateReply('😀'.repeat(500))).toBeNull();
    expect(validateReply('x'.repeat(501))).not.toBeNull();
  });
});

describe('timeline and profile tabs', () => {
  it('merges ids newest first without duplicates', () => {
    const t: Record<string, number> = { a: 3, b: 2, c: 1, d: 4 };
    expect(mergeIds(['a', 'c'], ['b', 'a', 'd'], (id) => t[id])).toEqual(['d', 'a', 'b', 'c']);
  });
  it('shows Likes only on my own profile', () => {
    expect(profileTabs(true)).toEqual(['posts', 'media', 'likes']);
    expect(profileTabs(false)).toEqual(['posts', 'media']);
  });
  it('filters posts per tab', () => {
    const withMedia = post({ postId: 'm', media: [{} as never] });
    const plain = post({ postId: 't' });
    const liked = post({ postId: 'l', likedByMe: true });
    expect(postsForTab('posts', [withMedia, plain], []).map((p) => p.postId)).toEqual(['m', 't']);
    expect(postsForTab('media', [withMedia, plain], []).map((p) => p.postId)).toEqual(['m']);
    expect(postsForTab('likes', [withMedia], [liked, plain]).map((p) => p.postId)).toEqual(['l']);
  });
});
