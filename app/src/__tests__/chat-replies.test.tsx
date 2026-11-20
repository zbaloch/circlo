import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ChatScreen } from '@/app/chat/[id]';
import { fromMessageRow, quoteLines, quoteOf, type ChatMessage, type Conversation } from '@/lib/messaging';

type Btn = { text: string; onPress?: () => void };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  Redirect: () => null,
}));
jest.mock('@/api/client', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/components/post-media', () => ({ MediaGrid: () => null }));
jest.mock('@/components/chat-title', () => ({ ChatTitle: () => null }));
jest.mock('@/components/keyboard-spacer', () => ({ KeyboardSpacer: () => null }));
jest.mock('@/components/ui/dialog-host', () => ({ DialogHost: () => null }));
const mockAlert = jest.fn();
jest.mock('@/lib/dialog', () => ({
  showAlert: (t: string, m?: string, b?: Btn[]) => mockAlert(t, m, b),
  dialogOpen: () => false,
  dismissDialog: jest.fn(),
}));
const account = { userId: 'me', handle: 'me' };
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedIn', account }) }));
jest.mock('@/lib/me', () => ({ useMe: () => null }));
jest.mock('@/lib/live', () => ({ onLiveChange: () => () => {} }));
jest.mock('@/lib/blocks', () => ({
  blockUser: jest.fn(),
  refreshBlocked: jest.fn(async () => {}),
  useBlocked: () => new Set<string>(),
  visibleMessages: (m: unknown[]) => m,
}));

const mockSend = jest.fn(async () => {});
let mockConv: Conversation;
jest.mock('@/lib/messaging', () => ({
  ...jest.requireActual('@/lib/messaging'),
  useConversations: () => [mockConv],
  syncMessaging: jest.fn(async () => {}),
  markRead: jest.fn(),
  sendMessage: (...args: unknown[]) => mockSend(...(args as [])),
}));

const message = (seq: number, senderUser: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  seq,
  messageId: `m${seq}`,
  senderUser,
  text,
  media: [],
  createdAtMs: Date.UTC(2026, 10, 20, 9, seq),
  mine: senderUser === 'me',
  ...extra,
});

const conversation = (messages: ChatMessage[]): Conversation => ({
  groupId: 'g1',
  name: null,
  members: ['bo'],
  people: { bo: { name: 'Bo', handle: 'bo' } },
  readSeq: 0,
  unread: 0,
  messages,
  active: true,
  updatedAtMs: 0,
});

describe('replying to a message in a chat', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads a reply’s quote from the server, and says who wrote it and what it said', () => {
    const m = fromMessageRow(
      {
        seq: 3,
        messageId: 'r',
        senderId: 'me',
        text: '8 works',
        media: [],
        replyTo: { messageId: 'q', available: true, senderId: 'bo', text: 'Dinner at 8?', mediaType: null },
        createdAt: '2026-11-20T10:00:00Z',
      },
      'me',
    );
    expect(m.replyTo).toEqual({ messageId: 'q', available: true, senderUser: 'bo', text: 'Dinner at 8?', mediaType: null });
    const name = (u: string) => (u === 'bo' ? 'Bo' : 'You');
    expect(quoteLines(m.replyTo!, name)).toEqual({ who: 'Bo', what: 'Dinner at 8?' });
    // A photo or video without words says what it is.
    expect(quoteLines({ messageId: 'q', available: true, senderUser: 'bo', text: '', mediaType: 'video' }, name).what).toBe('Video');
    expect(quoteLines(quoteOf(message(1, 'me', '', { media: [{ type: 'image' } as never] })), name)).toEqual({ who: 'You', what: 'Photo' });
    // Deleted, or from someone I blocked: nothing about it.
    expect(quoteLines({ messageId: 'q', available: false }, name)).toEqual({ who: null, what: 'Message unavailable' });
    expect(fromMessageRow({ seq: 1, messageId: 'a', senderId: 'bo', text: 'hi', media: [], createdAt: '2026-11-20T10:00:00Z' }, 'me').replyTo).toBeNull();
  });

  it('Reply in a message’s menu shows what I’m replying to, and sends the reply with it', async () => {
    mockConv = conversation([message(1, 'bo', 'Dinner at 8?'), message(2, 'bo', 'Or 9')]);
    await render(<ChatScreen />);
    await fireEvent.press(screen.getAllByLabelText('Message options')[0]);
    const buttons: Btn[] = mockAlert.mock.calls[0][2];
    expect(buttons[0].text).toBe('Reply');
    await fireEvent(screen.getByLabelText('Message'), 'changeText', '8 works');
    await act(async () => buttons[0].onPress!());
    expect(await screen.findByText('Replying to Bo')).toBeTruthy();
    expect(screen.getAllByText('Dinner at 8?')).toHaveLength(2);

    await fireEvent.press(screen.getByLabelText('Send message'));
    expect(mockSend).toHaveBeenCalledWith(account, 'g1', '8 works', [], 'm1');
    expect(screen.queryByText('Replying to Bo')).toBeNull();
  });

  it('a reply can be cancelled before sending', async () => {
    mockConv = conversation([message(1, 'me', 'Dinner at 8?')]);
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByLabelText('Message options'));
    await act(async () => mockAlert.mock.calls[0][2][0].onPress());
    expect(await screen.findByText('Replying to yourself')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Cancel reply'));
    expect(screen.queryByText('Replying to yourself')).toBeNull();
    await fireEvent(screen.getByLabelText('Message'), 'changeText', 'never mind');
    await fireEvent.press(screen.getByLabelText('Send message'));
    expect(mockSend).toHaveBeenCalledWith(account, 'g1', 'never mind', [], undefined);
  });

  it('shows the quote above a reply, and says when the quoted message is gone', async () => {
    mockConv = conversation([
      message(1, 'bo', 'Dinner at 8?'),
      message(2, 'me', '8 works', { replyTo: { messageId: 'm1', available: true, senderUser: 'bo', text: 'Dinner at 8?' } }),
      message(3, 'bo', 'what was that?', { replyTo: { messageId: 'gone', available: false } }),
    ]);
    await render(<ChatScreen />);
    expect(screen.getByLabelText('Reply to Bo: Dinner at 8?')).toBeTruthy();
    expect(screen.getByText('Message unavailable')).toBeTruthy();
  });

  it('there’s no Reply once I’ve left the chat', async () => {
    mockConv = { ...conversation([message(1, 'bo', 'hi')]), active: false };
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByLabelText('Message options'));
    expect(mockAlert.mock.calls[0][2].map((b: Btn) => b.text)).not.toContain('Reply');
  });
});
