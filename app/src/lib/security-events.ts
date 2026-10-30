import * as SecureStore from 'expo-secure-store';

import { api, ok } from '@/api/client';

import type { StoredAccount } from './keystore';

/**
 * "New sign-in to your account" (the server records each password login; only its time, nothing about the device).
 * Each phone remembers the newest sign-in it has dealt with, so it only alerts about the ones after it. A phone that
 * has no marker yet (just signed in, or just updated the app) starts from the newest one, which is usually its own.
 */
export type SignIn = { id: string; createdAt: string };

const seenKey = (userId: string) => `circlo.security-seen.${userId}`;

/** Pure: the sign-ins after `seenAt` (oldest first), and the marker to store. Exported for tests. */
export function unseenSignIns(events: SignIn[], seenAt: string | null): { unseen: SignIn[]; marker: string } {
  // Compare as times: the server's ISO strings may differ in fractional digits.
  const sorted = [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const newest = sorted.length ? sorted[sorted.length - 1].createdAt : '1970-01-01T00:00:00Z';
  if (seenAt === null) return { unseen: [], marker: newest };
  const after = sorted.filter((e) => Date.parse(e.createdAt) > Date.parse(seenAt));
  return { unseen: after, marker: seenAt };
}

/** Every sign-in of the last 30 days, newest first, for the Notifications tab. */
export async function listSignIns(): Promise<SignIn[]> {
  const res = ok(await api.GET('/v1/security-events'));
  return (res.events ?? []).filter((e) => e.kind === 'sign_in').map((e) => ({ id: e.id, createdAt: e.createdAt }));
}

/** Sign-ins this phone hasn't shown yet. */
export async function newSignIns(account: StoredAccount): Promise<SignIn[]> {
  const res = ok(await api.GET('/v1/security-events'));
  const events = (res.events ?? []).filter((e) => e.kind === 'sign_in').map((e) => ({ id: e.id, createdAt: e.createdAt }));
  const seenAt = await SecureStore.getItemAsync(seenKey(account.userId)).catch(() => null);
  const { unseen, marker } = unseenSignIns(events, seenAt);
  if (seenAt === null) await SecureStore.setItemAsync(seenKey(account.userId), marker).catch(() => undefined);
  return unseen;
}

/** "It was me" (or the password was changed): don't show these again. */
export async function markSignInsSeen(account: StoredAccount, signIns: SignIn[]): Promise<void> {
  const newest = unseenSignIns(signIns, null).marker;
  if (signIns.length) await SecureStore.setItemAsync(seenKey(account.userId), newest).catch(() => undefined);
}

/** Sign-out: nothing of the account stays on the phone. */
export async function forgetSignIns(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(seenKey(userId)).catch(() => undefined);
}
