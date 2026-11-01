/**
 * Friends (PLAN.md Phase 5): an invite link or QR code is the only way to connect (no search). Everyone has one link
 * that stays the same until they reset it (owner decision 2026-11-01). The person who opens it puts the inviter in
 * their circles and is connected at once; the inviter is told and can choose circles for them (until then: Everyone).
 * Profiles are visible to people you're connected with, never to strangers.
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

/** My invite link: the same every time, until I reset it. */
export async function getInviteLink(): Promise<string> {
  return ok(await api.GET('/v1/invites/link')).link;
}

/** A new link; the old one and its QR code stop working. People who joined stay connected. */
export async function resetInviteLink(): Promise<string> {
  return ok(await api.POST('/v1/invites/link/reset')).link;
}

export class InviteError extends Error {}

/** Pure: why an invite can't be used, from the server's answer (null: some other failure). Exported for tests. */
export function inviteProblem(status: number): string | null {
  if (status === 404) return 'This invite link doesn’t work any more. Ask them for their current link.';
  if (status === 400) return 'That’s your own invite link.';
  if (status === 409) return 'You’re already connected.';
  if (status === 429) return 'Too many people joined with this link today. Try again tomorrow.';
  return null;
}

function tokenOf(link: string): string {
  const token = parseInviteLink(link);
  if (!token) throw new InviteError('That isn’t a Circlo invite link.');
  return token;
}

function check<T extends { response: Response }>(res: T): T {
  const problem = inviteProblem(res.response.status);
  if (problem) throw new InviteError(problem);
  return res;
}

export type Inviter = { userId: string; name: string; handle: string; avatarUrl?: string | null };

/** Who an invite (link or QR) is from, without using it. */
export async function previewInvite(link: string): Promise<Inviter> {
  const p = ok(check(await api.POST('/v1/invites/preview', { body: { token: tokenOf(link) } })));
  return { userId: p.userId, name: p.name, handle: p.username, avatarUrl: p.avatarUrl };
}

/**
 * Uses an invite, putting its owner in my `circles` (they aren't told which). Someone's link connects us at once
 * ('accepted'); an old one-time invite sends a request ('outgoing').
 */
export async function joinInvite(account: StoredAccount, link: string, circles: number[] = []): Promise<'accepted' | 'outgoing'> {
  const r = ok(check(await api.POST('/v1/invites/join', { body: { token: tokenOf(link), circles } })));
  await refreshAddressBook(account);
  return r.status;
}

/** Pure: people who joined me since `known` was noted (while my link was on screen), newest first. Exported for tests. */
export function justJoined(connections: Connection[], known: ReadonlySet<string> | null): Connection[] {
  if (!known) return [];
  return connections.filter((c) => c.status === 'accepted' && !known.has(c.userId)).reverse();
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
