import { fromMessageRow, memberName, mergeMessages, unreadCount, type ChatMessage } from '@/lib/messaging';
import { chatTitle, clockTime, dayLabel, endsRun } from '@/lib/view-logic';

jest.mock('@/api/client', () => ({}));

const msg = (seq: number, mine: boolean, text = 't'): ChatMessage => ({
  seq,
  messageId: `m${seq}`,
  mine,
  senderUser: mine ? 'me' : 'b',
  text,
  media: [],
  createdAtMs: seq,
});

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

  it('shows the time of day under each message', () => {
    expect(clockTime(new Date(2026, 9, 27, 9, 5).getTime())).toMatch(/^9:05\sAM$/);
    expect(clockTime(new Date(2026, 9, 27, 21, 40).getTime())).toMatch(/^9:40\sPM$/);
  });

  it('puts the time under the last message of a run: same sender, minutes apart, same day', () => {
    const at = (h: number, m: number) => new Date(2026, 9, 27, h, m).getTime();
    const msg = (senderUser: string, createdAtMs: number) => ({ senderUser, createdAtMs });
    expect(endsRun(msg('a', at(9, 0)), msg('a', at(9, 3)))).toBe(false);
    expect(endsRun(msg('a', at(9, 0)), msg('b', at(9, 1)))).toBe(true);
    expect(endsRun(msg('a', at(9, 0)), msg('a', at(9, 6)))).toBe(true);
    expect(endsRun(msg('a', at(9, 0)), undefined)).toBe(true);
    expect(endsRun(msg('a', at(23, 59)), msg('a', new Date(2026, 9, 28, 0, 1).getTime()))).toBe(true);
  });

  it('takes the unread count from the server, so it’s the same on every device', () => {
    expect(unreadCount({ unread: 3 })).toBe(3);
  });

  it('merges new messages by sequence number without duplicates', () => {
    const merged = mergeMessages([msg(1, false), msg(3, true)], [msg(3, true, 'again'), msg(2, false), msg(4, false)]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(merged[2].text).toBe('again');
  });

  it('reads server messages and names members', () => {
    const m = fromMessageRow({ seq: 7, messageId: 'id', senderId: 'me', text: 'hi', media: [], createdAt: '2026-11-01T10:00:00Z' }, 'me');
    expect(m).toMatchObject({ seq: 7, mine: true, text: 'hi', createdAtMs: Date.parse('2026-11-01T10:00:00Z') });
    const conv = { people: { b: { name: 'Bob', handle: 'bob' } } };
    expect(memberName(conv, 'b', { userId: 'me' })).toBe('Bob');
    expect(memberName(conv, 'me', { userId: 'me' })).toBe('You');
    expect(memberName(conv, 'gone', { userId: 'me' })).toBe('Someone');
  });
});
