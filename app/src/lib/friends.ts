/**
 * Friends (PLAN.md Phase 5): an invite link or QR code is the only way to connect (no search). The person who opens
 * it sends a request and puts the inviter in their circles; the inviter accepts and picks circles too. Profiles are
 * visible to people you're connected with, never to strangers.
 */
import { api, ApiError, ok } from '@/api/client';

import { refreshAddressBook } from './addressbook';
import type { StoredAccount } from './keystore';

export const INVITE_HOST = 'https://www.hellocirclo.com/i/';

export type Profile = { displayName: string; bio: string; handle: string; avatarUrl?: string | null };

/**
 * The token from `https://www.hellocirclo.com/i/<token>` (also the web app's app.hellocirclo.com and `circlo://i/...`).
 * Pure; returns null if it isn't a Circlo invite link.
 */
export function parseInviteLink(link: string): string | null {
  const m = link.trim().match(/^(?:https:\/\/(?:www|app)\.hellocirclo\.com|circlo:\/)\/i\/([A-Za-z0-9_-]{16,64})\/?$/);
  return m ? m[1] : null;
}

/** A single-use invite link (valid 7 days). */
export async function createInviteLink(): Promise<string> {
  return ok(await api.POST('/v1/invites')).link;
}

export class InviteError extends Error {}

export type Inviter = { userId: string; name: string; handle: string; avatarUrl?: string | null };

/** Uses an invite (link or QR) and returns who sent it. */
export async function redeemInvite(link: string): Promise<Inviter> {
  const token = parseInviteLink(link);
  if (!token) throw new InviteError('That isn’t a Circlo invite link.');
  const res = await api.POST('/v1/invites/redeem', { body: { token } });
  if (res.response.status === 404) throw new InviteError('This invite has expired or was already used. Ask for a new one.');
  if (res.response.status === 400) throw new InviteError('That’s your own invite.');
  const p = ok(res);
  return { userId: p.userId, name: p.name, handle: p.username, avatarUrl: p.avatarUrl };
}

/** Asks someone whose invite I used to connect, putting them in `circles` (they aren't told which). */
export async function sendRequest(account: StoredAccount, toUserId: string, circles: number[] = []): Promise<void> {
  const res = await api.POST('/v1/friends/requests', { body: { toUserId, circles } });
  if (res.response.status !== 409) ok(res); // already connected: nothing to do
  await refreshAddressBook(account);
}

/** Uses an invite and sends the request in one go. Returns the inviter's user id. */
export async function acceptInvite(account: StoredAccount, link: string, circles: number[] = []): Promise<string> {
  const inviter = await redeemInvite(link);
  await sendRequest(account, inviter.userId, circles);
  return inviter.userId;
}

// ---------------- requests and friends ----------------

export type Connection = { userId: string; status: 'incoming' | 'outgoing' | 'accepted'; profile: Profile };

export async function syncConnections(account: StoredAccount): Promise<Connection[]> {
  const book = await refreshAddressBook(account);
  return Object.entries(book.contacts).map(([userId, c]) => ({
    userId,
    status: c.status,
    profile: { displayName: c.displayName, handle: c.handle, avatarUrl: c.avatarUrl, bio: '' },
  }));
}

/** Accepts a request and puts them in `circles` (none: they see Everyone posts only). */
export async function acceptRequest(account: StoredAccount, userId: string, circles: number[] = []): Promise<void> {
  ok(await api.POST('/v1/friends/{userId}/accept', { params: { path: { userId } }, body: { circles } }));
  await refreshAddressBook(account);
}

export async function declineRequest(account: StoredAccount, userId: string): Promise<void> {
  ok(await api.POST('/v1/friends/{userId}/decline', { params: { path: { userId } } }));
  await refreshAddressBook(account);
}

/** Someone's full profile (with bio and friend count), or null if we aren't connected. */
export async function loadProfile(userId: string): Promise<(Profile & { friendCount: number; relation: string }) | null> {
  try {
    const p = ok(await api.GET('/v1/users/{userId}', { params: { path: { userId } } }));
    return { displayName: p.name, handle: p.username, bio: p.bio, avatarUrl: p.avatarUrl, friendCount: p.friendCount, relation: p.relation };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
