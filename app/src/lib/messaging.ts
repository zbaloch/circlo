/**
 * Chats (PLAN.md Phase 9): 1:1 and group chats with friends, kept on the server so they're the same on every device
 * and in the web app. The inbox and open chats are refreshed by polling while the app is open (there is no remote
 * push). Read state is kept per person on the server.
 */
import { useSyncExternalStore } from 'react';

import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

import type { StoredAccount } from './keystore';
import type { Attachment, NewAttachment } from './media';

export type ChatMessage = {
  seq: number;
  messageId: string;
  senderUser: string;
  text: string;
  media: Attachment[];
  createdAtMs: number;
  mine: boolean;
};

export type ChatPerson = { name: string; handle: string; avatarUrl?: string | null };

export type Conversation = {
  groupId: string;
  /** The group's name, if it has one. */
  name?: string | null;
  /** Other members' user ids (me excluded). */
  members: string[];
  /** Other members' names and photos. */
  people: Record<string, ChatPerson>;
  readSeq: number;
  /** Unread messages from others, as the server counts them. */
  unread: number;
  lastMessage?: ChatMessage;
  /** Loaded once the chat has been opened, oldest first. */
  messages: ChatMessage[];
  /** False once I've left or been removed. */
  active: boolean;
  updatedAtMs: number;
};

type ChatRow = components['schemas']['Chat'];
type MessageRow = components['schemas']['Message'];

let conversations: Record<string, Conversation> = {};
let snapshot: Conversation[] = [];
const listeners = new Set<() => void>();

function notify() {
  snapshot = Object.values(conversations).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  listeners.forEach((l) => l());
}

/** The app's form of a message (pure; exported for tests). */
export function fromMessageRow(m: MessageRow, myId: string): ChatMessage {
  return { seq: m.seq, messageId: m.messageId, senderUser: m.senderId, text: m.text, media: m.media, createdAtMs: Date.parse(m.createdAt), mine: m.senderId === myId };
}

function fromChatRow(row: ChatRow, myId: string, previous?: Conversation): Conversation {
  const people: Record<string, ChatPerson> = {};
  for (const p of row.members) people[p.userId] = { name: p.name, handle: p.username, avatarUrl: p.avatarUrl };
  return {
    groupId: row.chatId,
    name: row.name,
    members: row.members.map((p) => p.userId),
    people,
    readSeq: row.readSeq,
    unread: row.unread,
    lastMessage: row.lastMessage ? fromMessageRow(row.lastMessage, myId) : undefined,
    messages: previous?.messages ?? [],
    active: true,
    updatedAtMs: Date.parse(row.updatedAt),
  };
}

function put(c: Conversation) {
  conversations = { ...conversations, [c.groupId]: c };
}

/** Merges messages by sequence number (pure; exported for tests). */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const bySeq = new Map(existing.map((m) => [m.seq, m]));
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Refreshes the inbox, and the messages of `openChat` if one is on screen. */
export async function syncMessaging(account: StoredAccount, openChat?: string): Promise<void> {
  const rows = ok(await api.GET('/v1/chats'));
  const live = new Set(rows.map((r) => r.chatId));
  for (const r of rows) put(fromChatRow(r, account.userId, conversations[r.chatId]));
  for (const c of Object.values(conversations)) if (!live.has(c.groupId) && c.active) put({ ...c, active: false });
  if (openChat && live.has(openChat)) {
    const conv = conversations[openChat];
    const last = conv.messages[conv.messages.length - 1]?.seq;
    const page = ok(
      await api.GET('/v1/chats/{chatId}/messages', { params: { path: { chatId: openChat }, query: last === undefined ? { limit: 200 } : { after: last, limit: 200 } } }),
    );
    put({ ...conversations[openChat], messages: mergeMessages(conv.messages, page.map((m) => fromMessageRow(m, account.userId))) });
  }
  notify();
}

/** Starts a chat with friends (a 1:1 chat with someone reopens the one we have). Returns its id. */
export async function startChat(account: StoredAccount, userIds: string[], name?: string): Promise<string> {
  const row = ok(await api.POST('/v1/chats', { body: { userIds, ...(name?.trim() ? { name: name.trim() } : {}) } }));
  put(fromChatRow(row, account.userId, conversations[row.chatId]));
  notify();
  return row.chatId;
}

export async function addPeople(account: StoredAccount, groupId: string, userIds: string[]): Promise<void> {
  const row = ok(await api.POST('/v1/chats/{chatId}/members', { params: { path: { chatId: groupId } }, body: { userIds } }));
  put(fromChatRow(row, account.userId, conversations[groupId]));
  notify();
}

/** Removes someone (they can't read anything sent afterwards), or leaves the chat when it's me. */
export async function removePerson(account: StoredAccount, groupId: string, userId: string): Promise<void> {
  ok(await api.DELETE('/v1/chats/{chatId}/members/{userId}', { params: { path: { chatId: groupId, userId } } }));
  await syncMessaging(account, userId === account.userId ? undefined : groupId);
}

export async function sendMessage(account: StoredAccount, groupId: string, text: string, media: NewAttachment[] = []): Promise<void> {
  const conv = conversations[groupId];
  if (conv && !conv.active) throw new Error('You’re no longer in this chat.');
  const row = ok(await api.POST('/v1/chats/{chatId}/messages', { params: { path: { chatId: groupId } }, body: { text: text.trim(), media } }));
  const msg = fromMessageRow(row, account.userId);
  const current = conversations[groupId];
  if (current) put({ ...current, messages: mergeMessages(current.messages, [msg]), lastMessage: msg, readSeq: msg.seq, updatedAtMs: msg.createdAtMs });
  notify();
}

/** Deletes one of my messages for everyone in the chat. */
export async function deleteMessage(groupId: string, message: ChatMessage): Promise<void> {
  ok(await api.DELETE('/v1/chats/{chatId}/messages/{messageId}', { params: { path: { chatId: groupId, messageId: message.messageId } } }));
  const conv = conversations[groupId];
  if (conv) put({ ...conv, messages: conv.messages.filter((m) => m.seq !== message.seq) });
  notify();
}

/** Marks the chat read up to its newest message (on every device). */
export async function markRead(groupId: string): Promise<void> {
  const conv = conversations[groupId];
  if (!conv) return;
  const last = conv.messages[conv.messages.length - 1]?.seq ?? conv.lastMessage?.seq ?? 0;
  if (last <= conv.readSeq && conv.unread === 0) return;
  put({ ...conv, readSeq: Math.max(conv.readSeq, last), unread: 0 });
  notify();
  await api.POST('/v1/chats/{chatId}/read', { params: { path: { chatId: groupId } }, body: { seq: last } }).catch(() => undefined);
}

/** Pure: unread messages from others in a conversation. */
export function unreadCount(c: Pick<Conversation, 'unread'>): number {
  return c.unread;
}

/** A member's display name in a chat (pure). */
export function memberName(c: Pick<Conversation, 'people'>, userId: string, account: Pick<StoredAccount, 'userId'>, me?: string | null): string {
  if (userId === account.userId) return me || 'You';
  return c.people[userId]?.name || 'Someone';
}

export function conversationsSnapshot(): Conversation[] {
  return snapshot;
}

export function useConversations(): Conversation[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => snapshot,
  );
}

/** Sign-out: forget the chats. */
export function clearMessaging() {
  conversations = {};
  notify();
}
