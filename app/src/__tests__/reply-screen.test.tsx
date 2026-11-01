import { fireEvent, render, screen } from '@testing-library/react-native';

import ReplyScreen from '@/app/reply/[id]';

let mockId = 'p1';
const mockPost = (postId: string) => ({ postId, authorId: 'a1', authorName: 'Ana', authorHandle: 'ana', text: 'hello', media: [], createdAtMs: Date.now(), replyCount: 0 });

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ id: mockId }),
  useFocusEffect: () => {},
}));
// The keyboard spacer runs on Reanimated's native runtime, which doesn't load under jest.
jest.mock('@/components/keyboard-spacer', () => ({ KeyboardSpacer: () => null }));
jest.mock('@/components/post-media', () => ({ MediaImage: () => null }));
jest.mock('@/components/post-card', () => ({ PostText: () => null }));
jest.mock('@/components/post-actions', () => ({ authorName: () => ({ name: 'Ana', handle: 'ana' }) }));
jest.mock('@/lib/addressbook', () => ({ loadAddressBook: jest.fn(() => new Promise(() => {})) }));
jest.mock('@/lib/feed-store', () => ({ putPost: jest.fn(), usePost: (id: string) => mockPost(id) }));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedIn', account: { userId: 'me', handle: 'me' } }) }));
jest.mock('@/lib/thread', () => ({
  MAX_REPLY_CHARS: 500,
  sendReply: jest.fn(() => Promise.resolve()),
  validateReply: (t: string) => (t.trim() ? null : 'empty'),
}));

describe('reply screen', () => {
  it('starts empty for the next post after a reply is sent, and its button isn’t stuck', async () => {
    const { sendReply } = jest.requireMock('@/lib/thread');
    const view = await render(<ReplyScreen />);
    await fireEvent.changeText(screen.getByLabelText('Reply'), 'So cute!');
    await fireEvent.press(screen.getByRole('button', { name: 'Send reply' }));
    expect(sendReply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ postId: 'p1' }), 'So cute!');

    // The drawer keeps this screen mounted; opening it for another post must not show the old text.
    mockId = 'p2';
    await view.rerender(<ReplyScreen />);
    expect(screen.getByLabelText('Reply').props.value).toBe('');
    await fireEvent.changeText(screen.getByLabelText('Reply'), 'Front seat!');
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeEnabled();
  });
});
