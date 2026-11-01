/**
 * The timeline, shared by Home, the thread view, profiles and the media viewer. Memory only; dropped at sign-out.
 */
import { useSyncExternalStore } from 'react';

import type { StoredAccount } from './keystore';
import type { Attachment } from './media';
import { fetchFeedPage, type FeedPost } from './posts';

type State = {
  ids: string[];
  cursor?: string;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  /** Fresh posts found by a background check, waiting behind the "New posts" pill. */
  pending: string[];
  error?: string;
  /** True after the first refresh finished, so the empty state never flashes before posts arrive. */
  loaded: boolean;
};

const posts = new Map<string, FeedPost>();
let state: State = { ids: [], hasMore: true, loading: false, refreshing: false, pending: [], loaded: false };
const listeners = new Set<() => void>();

type Snapshot = State & { posts: FeedPost[] };
let snapshot: Snapshot = { ...state, posts: [] };

function set(change: Partial<State>) {
  state = { ...state, ...change };
  // A new immutable snapshot on every change: components read it through useSyncExternalStore (never the module
  // variables directly), so React and the React Compiler always see current values.
  snapshot = { ...state, posts: state.ids.flatMap((id) => posts.get(id) ?? []) };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function remember(list: FeedPost[]) {
  for (const p of list) posts.set(p.postId, p);
}

/** Merges ids newest-first without duplicates (pure; exported for tests). */
export function mergeIds(existing: string[], incoming: string[], byTime: (id: string) => number): string[] {
  return [...new Set([...existing, ...incoming])].sort((a, b) => byTime(b) - byTime(a));
}

const time = (id: string) => posts.get(id)?.createdAtMs ?? 0;

export async function refreshFeed(account: StoredAccount) {
  if (state.refreshing) return;
  set({ refreshing: true, error: undefined });
  try {
    const page = await fetchFeedPage(account);
    remember(page.posts);
    // Keep older pages already loaded; drop anything that vanished from the first page's time range (deleted).
    const newest = page.posts.map((p) => p.postId);
    const floor = page.posts.length ? Math.min(...page.posts.map((p) => p.createdAtMs)) : Infinity;
    const older = state.ids.filter((id) => time(id) < floor);
    set({ ids: mergeIds(newest, page.hasMore ? older : [], time), cursor: state.cursor && older.length ? state.cursor : page.cursor, hasMore: page.hasMore, pending: [] });
  } catch {
    set({ error: 'Couldn’t refresh. Pull to try again.' });
  } finally {
    set({ refreshing: false, loaded: true });
  }
}

export async function loadMoreFeed(account: StoredAccount) {
  if (state.loading || !state.hasMore || !state.cursor) return;
  set({ loading: true });
  try {
    const page = await fetchFeedPage(account, state.cursor);
    remember(page.posts);
    set({ ids: mergeIds(state.ids, page.posts.map((p) => p.postId), time), cursor: page.cursor ?? state.cursor, hasMore: page.hasMore });
  } catch {
    // try again on the next scroll
  } finally {
    set({ loading: false });
  }
}

/** Background check for fresh posts; they wait behind the "New posts" pill instead of shifting the list. */
export async function checkForNewPosts(account: StoredAccount) {
  if (state.refreshing || state.ids.length === 0) return;
  try {
    const page = await fetchFeedPage(account, undefined, 20);
    const fresh = page.posts.filter((p) => !state.ids.includes(p.postId));
    remember(fresh);
    if (fresh.length) set({ pending: [...new Set([...state.pending, ...fresh.map((p) => p.postId)])] });
  } catch {
    // quiet: the pill just doesn't appear
  }
}

export function showPendingPosts() {
  set({ ids: mergeIds(state.pending, state.ids, time), pending: [] });
}

export function getPost(id: string): FeedPost | undefined {
  return posts.get(id);
}

export function putPost(post: FeedPost) {
  posts.set(post.postId, post);
  set({});
}

export function putPosts(list: FeedPost[]) {
  remember(list);
  set({});
}

export function removePost(id: string) {
  posts.delete(id);
  set({ ids: state.ids.filter((x) => x !== id), pending: state.pending.filter((x) => x !== id) });
}

export function clearFeed() {
  posts.clear();
  viewer = null;
  set({ ids: [], cursor: undefined, hasMore: true, pending: [], error: undefined, loaded: false });
}

export function useFeed(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Re-renders when this post changes (likes, reply counts). */
export function usePost(id: string | undefined): FeedPost | undefined {
  return useSyncExternalStore(subscribe, () => (id ? posts.get(id) : undefined));
}

// ---------------- media viewer hand-off (download URLs stay in memory, never in route params) ----------------

let viewer: { media: Attachment[]; index: number } | null = null;

export function openViewer(media: Attachment[], index: number) {
  viewer = { media, index };
}

export function viewerState() {
  return viewer;
}
