import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { emptyFilterText, filterValue, postFilterOptions } from '@/components/post-filter-bar';
import { ProfileFeed } from '@/components/profile-feed';
import { STARTER_CIRCLES } from '@/lib/addressbook';

jest.setTimeout(20_000);

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/api/client', () => ({}));
jest.mock('@/lib/addressbook', () => ({
  ...jest.requireActual('@/lib/addressbook'),
  loadAddressBook: async () => ({ circleDefs: [...jest.requireActual('@/lib/addressbook').STARTER_CIRCLES, { id: 6, name: 'Book Club', membersVisible: false }], contacts: {} }),
}));
const mockFetch = jest.fn();
jest.mock('@/lib/posts', () => ({
  ...jest.requireActual('@/lib/posts'),
  fetchAuthorPosts: (...a: unknown[]) => mockFetch(...a),
}));
jest.mock('@/lib/thread', () => ({ fetchUserReplies: async () => [] }));
// Cards need Reanimated's native runtime; a stand-in shows the post's text.
jest.mock('@/components/post-card', () => {
  const { Text } = jest.requireActual('react-native');
  return { PostCard: ({ post }: { post: { text: string } }) => <Text>{post.text}</Text> };
});
jest.mock('@/components/reply-card', () => ({ ReplyCard: () => null }));
jest.mock('@/components/post-actions', () => ({ usePostActions: () => ({ cardProps: () => ({}), sheet: null }) }));

const account = { userId: 'me', handle: 'me' } as never;
const post = (id: string, text: string) => ({ postId: id, text, media: [], authorId: 'me', mine: true, createdAtMs: 0 });

describe('filtering my profile by circle', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (_a: unknown, _u: string, opts: { audience?: unknown }) => ({
      posts: opts.audience === 'onlyMe' ? [post('p1', 'a thought')] : opts.audience === 2 ? [] : [post('p1', 'a thought'), post('p2', 'hello all')],
      hasMore: false,
    }));
  });

  it('shows only the posts shared with the chosen circle, Only me or Everyone', async () => {
    await render(<ProfileFeed account={account} userId="me" name="Me" />);
    expect(await screen.findByText('hello all')).toBeTruthy();
    // All, Only me, Everyone, then my circles in order.
    await waitFor(() => expect(screen.getByLabelText('Shared with Book Club')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Shared with Only me'));
    await waitFor(() => expect(screen.queryByText('hello all')).toBeNull());
    expect(screen.getByText('a thought')).toBeTruthy();
    expect(mockFetch).toHaveBeenLastCalledWith(account, 'me', { audience: 'onlyMe' });
    expect(screen.getByLabelText('Shared with Only me').props.accessibilityState).toEqual({ selected: true });

    await fireEvent.press(screen.getByLabelText('Shared with Close Friends'));
    expect(await screen.findByText('No posts shared with Close Friends yet.')).toBeTruthy();
    expect(mockFetch).toHaveBeenLastCalledWith(account, 'me', { audience: 2 });

    await fireEvent.press(screen.getByLabelText('All posts'));
    expect(await screen.findByText('hello all')).toBeTruthy();
  });

  it('isn’t there on anyone else’s profile, whose circles I never see', async () => {
    await render(<ProfileFeed account={account} userId="imran" name="Imran" />);
    expect(await screen.findByText('hello all')).toBeTruthy();
    expect(screen.queryByLabelText('All posts')).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(account, 'imran', { audience: undefined });
  });

  it('lists the choices and says when one is empty', () => {
    expect(postFilterOptions({ circleDefs: STARTER_CIRCLES }).map((o) => o.label)).toEqual([
      'All',
      'Only me',
      'Everyone',
      'Family',
      'Close Friends',
      'School',
      'Work',
      'Acquaintances',
    ]);
    expect(postFilterOptions({ circleDefs: STARTER_CIRCLES }).map((o) => filterValue(o.key))).toEqual([undefined, 'onlyMe', 'everyone', 1, 2, 3, 4, 5]);
    const [all, onlyMe] = postFilterOptions(null);
    expect(emptyFilterText(all, false)).toBeUndefined();
    expect(emptyFilterText(onlyMe, true)).toBe('No photos or videos just for you yet.');
  });
});
