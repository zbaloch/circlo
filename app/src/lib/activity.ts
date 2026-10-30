import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { api, ok } from '@/api/client';

import { putPosts } from './feed-store';
import type { StoredAccount } from './keystore';
import { fetchAuthorPosts } from './posts';
import { useSession } from './session';

/**
 * Replies and likes on my posts, for the Notifications tab (no remote push: the app fetches them itself). The server
 * already stores who replied and who liked; what a reply says stays encrypted until the thread is opened. Which items
 * I've seen is a time kept on this device only, and drives the bell's dot.
 */
export type ActivityItem = { kind: 'reply' | 'like'; postId: string; actorId: string; replyId?: string; createdAt: string };

type State = { owner: string | null; items: ActivityItem[] | null; seenAt: string | null };

let state: State = { owner: null, items: null, seenAt: null };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const seenKey = (userId: string) => `circlo.activity-seen.${userId}`;

/** Pure: how many items are newer than the seen time. Exported for tests. */
export function unseenCount(items: ActivityItem[] | null, seenAt: string | null): number {
  if (!items || seenAt === null) return 0;
  return items.filter((i) => Date.parse(i.createdAt) > Date.parse(seenAt)).length;
}

/** Fetches the latest activity, plus my recent posts so each row can say which post it is about (and open it). */
export async function refreshActivity(account: StoredAccount): Promise<void> {
  if (state.owner !== account.userId) set({ owner: account.userId, items: null, seenAt: null });
  const [res, seenAt] = await Promise.all([
    api.GET('/v1/activity', { params: { query: { limit: 50 } } }).then(ok),
    SecureStore.getItemAsync(seenKey(account.userId)).catch(() => null),
  ]);
  const items = (res.items ?? []) as ActivityItem[];
  if (state.owner !== account.userId) return;
  // First time on this phone: start from now rather than lighting the dot for everything that happened before.
  const start = seenAt ?? items[0]?.createdAt ?? new Date(0).toISOString();
  if (seenAt === null) await SecureStore.setItemAsync(seenKey(account.userId), start).catch(() => undefined);
  set({ items, seenAt: start });
}

/** Loads my own recent posts into the feed store, so activity rows can show and open them. */
export async function loadMyRecentPosts(account: StoredAccount): Promise<void> {
  const page = await fetchAuthorPosts(account, account.userId, { limit: 100 });
  putPosts(page.posts);
}

/** Opening the Notifications tab clears the dot. */
export async function markActivitySeen(account: StoredAccount): Promise<void> {
  const newest = state.owner === account.userId ? state.items?.[0]?.createdAt : undefined;
  if (!newest) return;
  set({ seenAt: newest });
  await SecureStore.setItemAsync(seenKey(account.userId), newest).catch(() => undefined);
}

/** Sign-out: nothing of the account stays on the phone. */
export async function forgetActivity(userId: string): Promise<void> {
  set({ owner: null, items: null, seenAt: null });
  await SecureStore.deleteItemAsync(seenKey(userId)).catch(() => undefined);
}

export function useActivity(): { items: ActivityItem[] | null; unseen: number } {
  const session = useSession();
  const s = useSyncExternalStore(subscribe, () => state);
  if (session.status !== 'signedIn' || s.owner !== session.account.userId) return { items: null, unseen: 0 };
  return { items: s.items, unseen: unseenCount(s.items, s.seenAt) };
}
