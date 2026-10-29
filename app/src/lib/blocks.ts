/**
 * Blocking (PLAN.md Phase 11; app store rules for user content). Blocking someone removes them as a friend (my keys
 * rotate, so they can't read anything new), and the server stops them sending requests or using my invites. Chats
 * already shared with them stay, but their messages are hidden on this device and they no longer trigger my pushes.
 */
import { useSyncExternalStore } from 'react';

import { api, ok } from '@/api/client';

import { loadAddressBook } from './addressbook';
import { unfriend } from './circles';
import type { StoredAccount } from './keystore';
import type { ChatMessage, Conversation } from './messaging';

let blocked: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const publish = (next: ReadonlySet<string>) => {
  blocked = next;
  listeners.forEach((l) => l());
};

/** Fetches who I blocked and updates everyone using `useBlocked`. */
export async function refreshBlocked(): Promise<ReadonlySet<string>> {
  const rows = ok(await api.GET('/v1/blocks'));
  publish(new Set(rows.flatMap((b) => (b.userId ? [b.userId] : []))));
  return blocked;
}

export function useBlocked(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => blocked,
  );
}

/** Blocks someone: unfriend first (rotates my keys so they can't read anything new), then block on the server. */
export async function blockUser(account: StoredAccount, userId: string): Promise<void> {
  const book = await loadAddressBook(account);
  if (book.contacts[userId]) await unfriend(account, userId).catch(() => undefined);
  ok(await api.POST('/v1/blocks/{userId}', { params: { path: { userId } } }));
  publish(new Set([...blocked, userId]));
}

export async function unblockUser(userId: string): Promise<void> {
  ok(await api.DELETE('/v1/blocks/{userId}', { params: { path: { userId } } }));
  publish(new Set([...blocked].filter((u) => u !== userId)));
}

/** Pure: messages without those from people I blocked. */
export function visibleMessages(messages: ChatMessage[], blockedIds: ReadonlySet<string>): ChatMessage[] {
  return blockedIds.size ? messages.filter((m) => m.mine || !blockedIds.has(m.senderUser)) : messages;
}

/** Pure: conversations without chats whose other members are all people I blocked, minus their messages. */
export function visibleConversations(conversations: Conversation[], blockedIds: ReadonlySet<string>): Conversation[] {
  if (!blockedIds.size) return conversations;
  return conversations
    .filter((c) => c.members.length === 0 || c.members.some((u) => !blockedIds.has(u)))
    .map((c) => ({ ...c, messages: visibleMessages(c.messages, blockedIds) }));
}
