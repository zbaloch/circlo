/**
 * Blocking (PLAN.md Phase 11; app store rules for user content). Blocking someone ends any connection: they can't see
 * my posts, send requests or use my invites, and their messages and activity are hidden from me.
 */
import { useSyncExternalStore } from 'react';

import { api, ok } from '@/api/client';

import { refreshAddressBook } from './addressbook';
import type { StoredAccount } from './keystore';
import type { ChatMessage, Conversation } from './messaging';

export type BlockedPerson = { userId: string; name: string; handle: string };

let blocked: ReadonlySet<string> = new Set();
let people: BlockedPerson[] = [];
const listeners = new Set<() => void>();
const publish = (next: BlockedPerson[]) => {
  people = next;
  blocked = new Set(next.map((p) => p.userId));
  listeners.forEach((l) => l());
};

/** Fetches who I blocked and updates everyone using `useBlocked`. */
export async function refreshBlocked(): Promise<ReadonlySet<string>> {
  const rows = ok(await api.GET('/v1/blocks'));
  publish(rows.map((b) => ({ userId: b.userId, name: b.name, handle: b.username })));
  return blocked;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useBlocked(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => blocked);
}

/** The people I blocked, with their names (Settings). */
export function useBlockedPeople(): BlockedPerson[] {
  return useSyncExternalStore(subscribe, () => people);
}

export async function blockUser(account: StoredAccount, userId: string, name = '', handle = ''): Promise<void> {
  ok(await api.POST('/v1/blocks/{userId}', { params: { path: { userId } } }));
  publish([...people.filter((p) => p.userId !== userId), { userId, name, handle }]);
  await refreshAddressBook(account).catch(() => undefined);
}

export async function unblockUser(userId: string): Promise<void> {
  ok(await api.DELETE('/v1/blocks/{userId}', { params: { path: { userId } } }));
  publish(people.filter((p) => p.userId !== userId));
}

/** Pure: messages without those from people I blocked (the server leaves them out too). */
export function visibleMessages(messages: ChatMessage[], blockedIds: ReadonlySet<string>): ChatMessage[] {
  return blockedIds.size ? messages.filter((m) => m.mine || !blockedIds.has(m.senderUser)) : messages;
}

/** Pure: conversations without chats whose other members are all people I blocked. */
export function visibleConversations(conversations: Conversation[], blockedIds: ReadonlySet<string>): Conversation[] {
  if (!blockedIds.size) return conversations;
  return conversations
    .filter((c) => c.members.length === 0 || c.members.some((u) => !blockedIds.has(u)))
    .map((c) => ({ ...c, messages: visibleMessages(c.messages, blockedIds) }));
}

/** Pure: whether the Messages tab shows its dot (a chat I'm still in has unread messages). */
export function hasUnreadChats(conversations: Conversation[], blockedIds: ReadonlySet<string>): boolean {
  return visibleConversations(conversations, blockedIds).some((c) => c.active && c.unread > 0);
}
