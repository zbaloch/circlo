/**
 * Circles (PLAN.md Phase 6, CRYPTO.md section 8.4). Author-only: labels and placements live in the encrypted address
 * book and are never shown to anyone else. Every placement change, inward or outward, and every unfriend rotates the
 * epoch, so the server can't tell who moved or how.
 */
import * as Core from '@halqo/core';

import { api, ApiError, ok } from '@/api/client';

import { loadAddressBook, updateAddressBook, type AddressBook, type MyEpoch } from './addressbook';
import { toB64, uuidFromRandom } from './bytes';
import { friendPayload, loadMyProfile, saveMyProfile } from './friends';
import type { StoredAccount } from './keystore';

export const MIN_FRIEND_CIRCLE = 2; // circle 1 is "Me only"
export const MAX_CIRCLE = 100;

/** PLAN.md Phase 6 defaults; 11–100 are unnamed until the author names them. */
export const DEFAULT_LABELS: Record<number, string> = {
  1: 'Me only',
  2: 'Spouse',
  3: 'Kids',
  4: 'Kids',
  5: 'Parents & siblings',
  6: 'Extended family',
  7: 'Closest friends',
  8: 'Neighbourhood',
  9: 'Work',
  10: 'Faded contacts',
};

// ---------------- pure helpers (tested without the core) ----------------

export function labelOf(book: Pick<AddressBook, 'labels'>, circle: number): string {
  return book.labels?.[String(circle)] || DEFAULT_LABELS[circle] || `Circle ${circle}`;
}

/** Friends placed exactly in this circle. */
export function membersOf(book: Pick<AddressBook, 'contacts'>, circle: number): string[] {
  return Object.entries(book.contacts)
    .filter(([, c]) => c.circle === circle)
    .map(([id]) => id);
}

/** How many friends can read a post sent to `circle`: everyone in that circle or closer. */
export function audienceSize(book: Pick<AddressBook, 'contacts'>, circle: number): number {
  return Object.values(book.contacts).filter((c) => c.circle <= circle).length;
}

/** Circles worth listing: 1–10, plus any custom circle that's named or has members. */
export function listedCircles(book: Pick<AddressBook, 'labels' | 'contacts'>): number[] {
  const custom = new Set<number>();
  for (const k of Object.keys(book.labels ?? {})) if (Number(k) > 10) custom.add(Number(k));
  for (const c of Object.values(book.contacts)) if (c.circle > 10) custom.add(c.circle);
  return [...Array.from({ length: 10 }, (_, i) => i + 1), ...[...custom].sort((a, b) => a - b)];
}

export function nextCustomCircle(book: Pick<AddressBook, 'labels' | 'contacts'>): number | null {
  const used = new Set(listedCircles(book));
  for (let n = 11; n < MAX_CIRCLE; n++) if (!used.has(n)) return n;
  return null;
}

export function isValidFriendCircle(circle: number): boolean {
  return Number.isInteger(circle) && circle >= MIN_FRIEND_CIRCLE && circle <= MAX_CIRCLE;
}

// ---------------- labels ----------------

export async function renameCircle(account: StoredAccount, circle: number, label: string): Promise<void> {
  const clean = label.trim().slice(0, 40);
  await updateAddressBook(account, (b) => {
    b.labels = b.labels ?? {};
    if (clean) b.labels[String(circle)] = clean;
    else delete b.labels[String(circle)];
  });
}

// ---------------- placements and rotation ----------------

/** Silently moves a friend to another circle (no notification to anyone), then rotates keys. */
export async function placeFriend(account: StoredAccount, userId: string, circle: number): Promise<void> {
  if (!isValidFriendCircle(circle)) throw new Error('invalid circle');
  const book = await loadAddressBook(account);
  if (!book.contacts[userId] || book.contacts[userId].circle === circle) return;
  await updateAddressBook(account, (b) => {
    if (b.contacts[userId]) b.contacts[userId].circle = circle;
  });
  await rotateEpoch(account);
}

/** Removes the friendship and every key between us, then rotates so they can't read anything new. */
export async function unfriend(account: StoredAccount, userId: string): Promise<void> {
  const res = await api.DELETE('/v1/friends/{userId}', { params: { path: { userId } } });
  if (res.response.status !== 404) ok(res);
  await updateAddressBook(account, (b) => {
    delete b.contacts[userId];
  });
  await rotateEpoch(account);
}

/**
 * Starts a new epoch: fresh C1 and profile key, a re-wrapped payload for every friend at their circle, profile
 * re-encrypted. The new epoch is saved to the encrypted address book before anything else, so an interruption
 * never loses it; `resumePendingRotation` finishes the job.
 */
export async function rotateEpoch(account: StoredAccount): Promise<void> {
  const book = await loadAddressBook(account);
  if (!book.pendingRotation) {
    const epoch: MyEpoch = {
      epochId: uuidFromRandom(Core.newSymmetricKey()),
      root: toB64(Core.newSymmetricKey()),
      profileKey: toB64(Core.newSymmetricKey()),
      createdAt: new Date().toISOString(),
    };
    await updateAddressBook(account, (b) => {
      b.myEpochs.push(epoch);
      b.pendingRotation = { epochId: epoch.epochId, startedAt: epoch.createdAt };
    });
  }
  await withRetry(() => finishRotation(account));
}

/** Finishes an interrupted rotation (call on startup and when opening Circles). No-op if none is pending. */
export async function resumePendingRotation(account: StoredAccount): Promise<boolean> {
  const book = await loadAddressBook(account);
  if (!book.pendingRotation) return false;
  await withRetry(() => finishRotation(account));
  return true;
}

async function finishRotation(account: StoredAccount): Promise<void> {
  const book = await loadAddressBook(account);
  const pending = book.pendingRotation;
  if (!pending) return;
  const epoch = book.myEpochs.find((e) => e.epochId === pending.epochId);
  if (!epoch) throw new Error('pending epoch missing');

  // Register the epoch (a retry may find it already registered).
  const reg = await api.POST('/v1/epochs', { body: { epochId: epoch.epochId } });
  if (!reg.response.ok && reg.response.status !== 409) ok(reg);

  // Everyone who gets my keys: accepted friends and my pending requests. Changed identities wait for re-verification.
  const recipients = ok(await api.GET('/v1/friends')).filter((f) => f.status !== 'incoming');
  const payloads = recipients.flatMap((f) => {
    const c = book.contacts[f.userId!];
    if (!c || c.identityChanged) return [];
    return [{ toUserId: f.userId!, epochId: epoch.epochId, ciphertext: friendPayload(account, epoch, f.userId!, c.x25519, c.circle) }];
  });
  for (let i = 0; i < payloads.length; i += 200) {
    ok(await api.PUT('/v1/friend-payloads/batch', { body: { payloads: payloads.slice(i, i + 200) } }));
  }

  // Re-encrypt my profile under the new profile key (ex-friends lose access to future profile changes).
  const profile = await loadMyProfile(account);
  if (profile) await saveMyProfile(account, profile);

  await updateAddressBook(account, (b) => {
    if (b.pendingRotation?.epochId === epoch.epochId) delete b.pendingRotation;
  });
}

async function withRetry(job: () => Promise<void>, attempts = 3): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await job();
    } catch (e) {
      const permanent = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 409 && e.status !== 429;
      if (permanent || i + 1 >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 3 ** i));
    }
  }
}
