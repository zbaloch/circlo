import { unreadCount, type ChatMessage } from '@/lib/messaging';
import { chatTitle, dayLabel } from '@/lib/view-logic';

// Native modules don't load under jest; these tests cover the pure logic only.
jest.mock('@circlo/core', () => ({}));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-video-thumbnails', () => ({}));

const msg = (seq: number, mine: boolean): ChatMessage => ({ seq, mine, senderUser: mine ? 'me' : 'b', senderDevice: 'd', text: 't', media: [], createdAtMs: seq });

describe('chat helpers', () => {
  it('titles chats from member names', () => {
    expect(chatTitle([])).toBe('Just you');
    expect(chatTitle(['Bob'])).toBe('Bob');
    expect(chatTitle(['Bob', 'Carol'])).toBe('Bob and Carol');
    expect(chatTitle(['Bob', 'Carol', 'Dan'])).toBe('Bob, Carol and 1 other');
    expect(chatTitle(['Bob', 'Carol', 'Dan', 'Eve'])).toBe('Bob, Carol and 2 others');
  });

  it('labels days for separators', () => {
    const now = new Date(2026, 9, 27, 15, 0).getTime();
    expect(dayLabel(now - 3_600_000, now)).toBe('Today');
    expect(dayLabel(now - 86_400_000, now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 1).getTime(), now)).toMatch(/Oct 1/);
    expect(dayLabel(new Date(2024, 0, 3).getTime(), now)).toMatch(/2024/);
  });

  it('counts unread messages from others after my read position (kept on this device)', () => {
    const messages = [msg(1, false), msg(2, true), msg(3, false), msg(4, false)];
    expect(unreadCount({ messages, readSeq: 0 })).toBe(3);
    expect(unreadCount({ messages, readSeq: 3 })).toBe(1);
    expect(unreadCount({ messages, readSeq: 4 })).toBe(0);
  });
});
