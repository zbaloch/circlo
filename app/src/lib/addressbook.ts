/**
 * My people and circles as the server knows them: everyone I'm connected with (friends and pending requests either
 * way) with the circles I put them in, and my circle names. Circle names and memberships are mine only; the server
 * never shows them to anyone else. Cached in memory; mutations in circles.ts and friends.ts reload it.
 */
import { api, ok } from '@/api/client';

import type { StoredAccount } from './keystore';

/** Who a post is for: only me, all my friends, or one or more of my circles. */
export type Audience = { kind: 'onlyMe' } | { kind: 'everyone' } | { kind: 'circles'; ids: number[] };

/** One of my circles: an id 1–8 and the name only I see. */
export type CircleDef = { id: number; name: string };

export type Contact = {
  status: 'accepted' | 'incoming' | 'outgoing';
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  /** Mine to know: the circles (ids) I put them in. Never shown to them. */
  circles: number[];
};

export type AddressBook = {
  contacts: Record<string, Contact>;
  circleDefs: CircleDef[];
};

/** Starter circles of a new account (the server creates them; owner decision 2026-10-29). */
export const STARTER_CIRCLES: CircleDef[] = [
  { id: 1, name: 'Close Friends' },
  { id: 2, name: 'Family' },
  { id: 3, name: 'Kids' },
  { id: 4, name: 'Work' },
];
export const MAX_CIRCLES = 8;

let cache: { owner: string; book: AddressBook } | null = null;
let loading: Promise<AddressBook> | null = null;

export function resetAddressBookCache() {
  cache = null;
  loading = null;
}

/** Pure: the book from the server's lists. Exported for tests. */
export function bookFrom(
  friends: { userId: string; status: Contact['status']; name: string; username: string; avatarUrl?: string | null; circles: number[] }[],
  circles: { id: number; name: string }[],
): AddressBook {
  const contacts: Record<string, Contact> = {};
  for (const f of friends) {
    contacts[f.userId] = { status: f.status, displayName: f.name, handle: f.username, avatarUrl: f.avatarUrl, circles: f.circles };
  }
  return { contacts, circleDefs: circles.map((c) => ({ id: c.id, name: c.name })) };
}

/** Fetches my connections and circles again. */
export function refreshAddressBook(account: StoredAccount): Promise<AddressBook> {
  loading ??= Promise.all([api.GET('/v1/friends').then(ok), api.GET('/v1/circles').then(ok)])
    .then(([friends, circles]) => {
      const book = bookFrom(friends, circles);
      cache = { owner: account.userId, book };
      return book;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export async function loadAddressBook(account: StoredAccount): Promise<AddressBook> {
  if (cache && cache.owner === account.userId) return cache.book;
  return refreshAddressBook(account);
}
