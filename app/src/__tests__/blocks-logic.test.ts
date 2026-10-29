import { visibleConversations, visibleMessages } from '@/lib/blocks';
import type { ChatMessage, Conversation } from '@/lib/messaging';

jest.mock('@circlo/core', () => ({}));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-secure-store', () => ({}));

const msg = (seq: number, senderUser: string, mine = false): ChatMessage => ({ seq, senderUser, senderDevice: 'd', text: `m${seq}`, media: [], createdAtMs: seq, mine });
const conv = (groupId: string, members: string[], messages: ChatMessage[]): Conversation =>
  ({ groupId, members, messages, cursor: 0, readSeq: 0, active: true, unverified: false, updatedAtMs: 0 }) as Conversation;

describe('blocked people in chats', () => {
  const blocked = new Set(['bad']);

  it('hides messages from people I blocked, but never my own', () => {
    expect(visibleMessages([msg(1, 'bad'), msg(2, 'ok'), msg(3, 'me', true)], blocked).map((m) => m.seq)).toEqual([2, 3]);
  });

  it('hides a chat only when everyone else in it is blocked', () => {
    const shown = visibleConversations([conv('one', ['bad'], [msg(1, 'bad')]), conv('group', ['bad', 'ok'], [msg(1, 'bad'), msg(2, 'ok')]), conv('alone', [], [])], blocked);
    expect(shown.map((c) => c.groupId)).toEqual(['group', 'alone']);
    expect(shown[0].messages.map((m) => m.seq)).toEqual([2]);
  });

  it('changes nothing when nobody is blocked', () => {
    const list = [conv('one', ['bad'], [msg(1, 'bad')])];
    expect(visibleConversations(list, new Set())).toBe(list);
  });
});
