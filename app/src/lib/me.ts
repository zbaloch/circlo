/**
 * My own account as the server has it (name, @handle, email, bio, photo), shared by every screen. Memory only;
 * fetched again on each launch.
 */
import { useSyncExternalStore } from 'react';

import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

export type Me = components['schemas']['Me'];

let me: Me | null = null;
const listeners = new Set<() => void>();

export function setMe(next: Me | null) {
  me = next;
  listeners.forEach((l) => l());
}

export function getMe(): Me | null {
  return me;
}

/** My display name, for my own posts and replies. */
export function getMyName(): string | null {
  return me?.name ?? null;
}

export async function refreshMe(): Promise<Me> {
  const fresh = ok(await api.GET('/v1/me'));
  setMe(fresh);
  return fresh;
}

export async function saveProfile(name: string, bio: string): Promise<Me> {
  const fresh = ok(await api.PUT('/v1/me/profile', { body: { name: name.trim(), bio: bio.trim() } }));
  setMe(fresh);
  return fresh;
}

export function useMe(): Me | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => me,
  );
}
