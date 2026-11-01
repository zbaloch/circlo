/**
 * Posts being published in the background, shown as "uploading…" cards on Home (PLAN.md section 2A) so the composer
 * closes immediately. Memory only: drafts and their media never touch disk outside the app's private cache.
 */
import { useSyncExternalStore } from 'react';

import type { StoredAccount } from './keystore';
import { putPost } from './feed-store';
import { publishPost, type Draft } from './posts';

export type OutboxItem = {
  id: string;
  draft: Draft;
  progress: number;
  status: 'uploading' | 'failed' | 'done';
  error?: string;
  postId?: string;
};

let items: OutboxItem[] = [];
const listeners = new Set<() => void>();

function set(next: OutboxItem[]) {
  items = next;
  listeners.forEach((l) => l());
}

function patch(id: string, change: Partial<OutboxItem>) {
  set(items.map((i) => (i.id === id ? { ...i, ...change } : i)));
}

function run(account: StoredAccount, id: string, onDone?: () => void) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  publishPost(account, item.draft, (progress) => patch(id, { progress })).then(
    (post) => {
      putPost(post);
      patch(id, { status: 'done', progress: 1, postId: post.postId });
      onDone?.();
    },
    (e: unknown) => patch(id, { status: 'failed', error: e instanceof Error ? e.message : 'Upload failed' }),
  );
}

export function enqueuePost(account: StoredAccount, draft: Draft, onDone?: () => void): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  set([{ id, draft, progress: 0, status: 'uploading' }, ...items]);
  run(account, id, onDone);
  return id;
}

export function retryPost(account: StoredAccount, id: string, onDone?: () => void) {
  patch(id, { status: 'uploading', progress: 0, error: undefined });
  run(account, id, onDone);
}

export function dismissPost(id: string) {
  set(items.filter((i) => i.id !== id));
}

export function clearOutbox() {
  set([]);
}

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
}
