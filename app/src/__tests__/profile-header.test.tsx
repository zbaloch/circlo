import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ProfileFeed } from '@/components/profile-feed';
import { photoAttachment, viewerState } from '@/lib/feed-store';

jest.setTimeout(20_000);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: jest.fn() },
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/api/client', () => ({}));
jest.mock('@/lib/addressbook', () => ({
  ...jest.requireActual('@/lib/addressbook'),
  loadAddressBook: async () => ({ circleDefs: [], contacts: {} }),
}));
jest.mock('@/lib/posts', () => ({
  ...jest.requireActual('@/lib/posts'),
  fetchAuthorPosts: async () => ({ posts: [], cursor: undefined, hasMore: false }),
}));
jest.mock('@/lib/thread', () => ({ fetchUserReplies: async () => [] }));
// Cards need Reanimated's native runtime; the header is what's tested here.
jest.mock('@/components/post-card', () => ({ PostCard: () => null }));
jest.mock('@/components/reply-card', () => ({ ReplyCard: () => null }));
jest.mock('@/components/post-actions', () => ({ usePostActions: () => () => ({}) }));

const account = { userId: 'me', handle: 'me' } as never;
const photo = 'https://media.example.test/avatars/abc.jpg?X-Amz-Signature=1';

describe('profile header', () => {
  beforeEach(() => mockPush.mockReset());

  it('opens their photo full screen when it’s tapped', async () => {
    await render(<ProfileFeed account={account} userId="imran" name="Imran Gul" handle="imrangul" avatarUrl={photo} />);
    await fireEvent.press(screen.getByLabelText('Imran Gul’s photo'));
    expect(mockPush).toHaveBeenCalledWith('/viewer');
    expect(viewerState()).toEqual({ media: [photoAttachment(photo)], index: 0 });
  });

  it('has nothing to open without a photo: just their initial', async () => {
    await render(<ProfileFeed account={account} userId="imran" name="Imran Gul" handle="imrangul" avatarUrl={null} />);
    await waitFor(() => expect(screen.getByText('I')).toBeTruthy());
    expect(screen.queryByLabelText('Imran Gul’s photo')).toBeNull();
  });

  it('keys the cached photo by its file, not the signed URL', () => {
    expect(photoAttachment(photo)).toMatchObject({ type: 'image', url: photo, objectKey: 'https://media.example.test/avatars/abc.jpg' });
  });
});
