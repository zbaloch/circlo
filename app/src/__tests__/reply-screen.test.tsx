import { fireEvent, render, screen } from '@testing-library/react-native';

import ReplyScreen from '@/app/reply/[id]';

let mockId = 'p1';
let mockFrom: string | undefined;
const mockPost = (postId: string) => ({ postId, authorId: 'a1', authorName: 'Ana', authorHandle: 'ana', text: 'hello', media: [], createdAtMs: Date.now(), replyCount: 0 });

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: mockId, from: mockFrom }),
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
  sendReply: jest.fn(() => Promise.resolve({ replyId: 'r9' })),
  noteSentReply: jest.fn(),
  validateReply: (t: string) => (t.trim() ? null : 'empty'),
}));

jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

describe('reply screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockId = 'p1';
    mockFrom = undefined;
  });

  it('from the timeline: goes back and shows a "Reply sent · View" toast that opens the reply', async () => {
    const { router } = jest.requireMock('expo-router');
    const { showToast } = jest.requireMock('@/lib/toast');
    const { noteSentReply } = jest.requireMock('@/lib/thread');
    await render(<ReplyScreen />);
    await fireEvent.changeText(screen.getByLabelText('Reply'), 'Lovely');
    await fireEvent.press(screen.getByRole('button', { name: 'Send reply' }));
    expect(router.back).toHaveBeenCalled();
    expect(noteSentReply).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Reply sent', expect.objectContaining({ text: 'View' }));
    showToast.mock.calls[0][1].onPress();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/post/[id]', params: { id: 'p1', reply: 'r9' } });
  });

  it('from the thread: goes back and hands the reply to the thread to highlight, no toast', async () => {
    mockFrom = 'thread';
    const { showToast } = jest.requireMock('@/lib/toast');
    const { noteSentReply } = jest.requireMock('@/lib/thread');
    await render(<ReplyScreen />);
    await fireEvent.changeText(screen.getByLabelText('Reply'), 'Lovely');
    await fireEvent.press(screen.getByRole('button', { name: 'Send reply' }));
    expect(noteSentReply).toHaveBeenCalledWith('p1', { replyId: 'r9' });
    expect(showToast).not.toHaveBeenCalled();
  });

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
