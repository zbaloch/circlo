import { useSyncExternalStore } from 'react';

import { api, ok } from '@/api/client';

import type { StoredAccount } from './keystore';
import { useSession } from './session';
import { deleteItem, getItem, setItem } from './storage';
import { shownActivity } from './view-logic';

/**
 * Replies and likes on my posts and likes on my replies, for the Notifications tab (no remote push: the app fetches them itself). Which items
 * I've seen is a time kept on this device, and drives the bell's dot.
 */
export type ActivityItem = {
  kind: 'reply' | 'like' | 'reply_like';
  postId: string;
  postText: string;
  actorId: string;
  actorName: string;
  actorHandle: string;
  actorAvatar?: string | null;
  replyId?: string | null;
  replyText?: string | null;
  createdAt: string;
};

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

type Row = Awaited<ReturnType<typeof fetchRows>>[number];

async function fetchRows() {
  return ok(await api.GET('/v1/activity', { params: { query: { limit: 50 } } })).items;
}

function fromRow(r: Row): ActivityItem {
  return {
    kind: r.kind,
    postId: r.postId,
    postText: r.postText,
    actorId: r.actorId,
    actorName: r.actor.name,
    actorHandle: r.actor.username,
    actorAvatar: r.actor.avatarUrl,
    replyId: r.replyId,
    replyText: r.replyText,
    createdAt: r.createdAt,
  };
}

export async function refreshActivity(account: StoredAccount): Promise<void> {
  if (state.owner !== account.userId) set({ owner: account.userId, items: null, seenAt: null });
  const [rows, seenAt] = await Promise.all([fetchRows(), getItem(seenKey(account.userId))]);
  const items = shownActivity(rows.map(fromRow));
  if (state.owner !== account.userId) return;
  // First time on this device: start from now rather than lighting the dot for everything that happened before.
  const start = seenAt ?? items[0]?.createdAt ?? new Date(0).toISOString();
  if (seenAt === null) await setItem(seenKey(account.userId), start).catch(() => undefined);
  set({ items, seenAt: start });
}

/** Opening the Notifications tab clears the dot. */
export async function markActivitySeen(account: StoredAccount): Promise<void> {
  const newest = state.owner === account.userId ? state.items?.[0]?.createdAt : undefined;
  if (!newest) return;
  set({ seenAt: newest });
  await setItem(seenKey(account.userId), newest).catch(() => undefined);
}

/** Sign-out: nothing of the account stays on the device. */
export async function forgetActivity(userId: string): Promise<void> {
  set({ owner: null, items: null, seenAt: null });
  await deleteItem(seenKey(userId));
}

export function useActivity(): { items: ActivityItem[] | null; unseen: number } {
  const session = useSession();
  const s = useSyncExternalStore(subscribe, () => state);
  if (session.status !== 'signedIn' || s.owner !== session.account.userId) return { items: null, unseen: 0 };
  return { items: s.items, unseen: unseenCount(s.items, s.seenAt) };
}
