/**
 * Circles (PLAN.md Phase 6, CRYPTO.md sections 8.4–8.5). Author-only: labels and placements live in the encrypted
 * address book and are never shown to anyone else. Every placement change, inward or outward, every Close Friends
 * change and every unfriend rotates the epoch, so the server can't tell who moved or how.
 *
 * Chain position 1 is "Only me" (level 0, not a circle). The default circles sit at positions 20, 40, 60, 80 and 100,
 * leaving room for circles added between them later; the app shows them as levels 1–5 by order. Close Friends is
 * an exclusive circle off the chain: only its members read posts to it.
 */
import * as Core from '@circlo/core';

import { api, ApiError, ok } from '@/api/client';

import { CLOSE_FRIENDS, loadAddressBook, recordPlacement, updateAddressBook, type AddressBook, type MyEpoch } from './addressbook';
import { toB64, uuidFromRandom } from './bytes';
import { friendPayload, loadMyProfile, saveMyProfile } from './friends';
import type { StoredAccount } from './keystore';

export const ONLY_ME = 1;
export const MIN_FRIEND_CIRCLE = 2; // position 1 is "Only me"
export const MAX_CIRCLE = 100;

/** Default circles, closest first (owner decision 2026-10-28). */
export const DEFAULT_CIRCLES = [20, 40, 60, 80, 100] as const;
export const DEFAULT_LABELS: Record<number, string> = {
  1: 'Only me',
  20: 'My person',
  40: 'Kids',
  60: 'Parents & siblings',
  80: 'Friends',
  100: 'Everyone',
};
export const CLOSE_FRIENDS_LABEL = 'Close Friends';

/** Circles I add myself go between Friends and Everyone. */
const CUSTOM_RANGE = [81, 99] as const;

// ---------------- pure helpers (tested without the core) ----------------

export function labelOf(book: Pick<AddressBook, 'labels'>, circle: number): string {
  if (circle === CLOSE_FRIENDS) return CLOSE_FRIENDS_LABEL;
  return book.labels?.[String(circle)] || DEFAULT_LABELS[circle] || `Circle ${circle}`;
}

/** Friends placed exactly in this circle (for Close Friends: its members). */
export function membersOf(book: Pick<AddressBook, 'contacts'>, circle: number): string[] {
  return Object.entries(book.contacts)
    .filter(([, c]) => (circle === CLOSE_FRIENDS ? !!c.closeFriend : c.circle === circle))
    .map(([id]) => id);
}

/** How many friends can read a post sent to `circle`: that circle or closer; for Close Friends, its members only. */
export function audienceSize(book: Pick<AddressBook, 'contacts'>, circle: number): number {
  if (circle === CLOSE_FRIENDS) return membersOf(book, CLOSE_FRIENDS).length;
  return Object.values(book.contacts).filter((c) => c.circle <= circle).length;
}

/** Chain circles worth listing, closest first: Only me, the defaults, and any other circle that's named or has members. */
export function listedCircles(book: Pick<AddressBook, 'labels' | 'contacts'>): number[] {
  const all = new Set<number>([ONLY_ME, ...DEFAULT_CIRCLES]);
  for (const k of Object.keys(book.labels ?? {})) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= MIN_FRIEND_CIRCLE && n <= MAX_CIRCLE) all.add(n);
  }
  for (const c of Object.values(book.contacts)) all.add(c.circle);
  return [...all].sort((a, b) => a - b);
}

/** The level shown to the author: 0 for Only me, then 1, 2, 3… in order (positions are an internal detail). */
export function levelOf(book: Pick<AddressBook, 'labels' | 'contacts'>, circle: number): number {
  if (circle === ONLY_ME) return 0;
  return listedCircles(book)
    .filter((n) => n !== ONLY_ME)
    .indexOf(circle) + 1;
}

export function nextCustomCircle(book: Pick<AddressBook, 'labels' | 'contacts'>): number | null {
  const used = new Set(listedCircles(book));
  for (let n = CUSTOM_RANGE[0]; n <= CUSTOM_RANGE[1]; n++) if (!used.has(n)) return n;
  return null;
}

export function isValidFriendCircle(circle: number): boolean {
  return Number.isInteger(circle) && circle >= MIN_FRIEND_CIRCLE && circle <= MAX_CIRCLE;
}

/** Old layout (circles 1–10) → new positions: Spouse → My person, … , Faded contacts and beyond → Everyone. */
export function migratedCircle(old: number): number {
  if (old <= 1) return ONLY_ME;
  if (old === 2) return 20;
  if (old <= 4) return 40;
  if (old <= 6) return 60;
  if (old <= 9) return 80;
  return 100;
}

// ---------------- labels ----------------

export async function renameCircle(account: StoredAccount, circle: number, label: string): Promise<void> {
  if (circle === CLOSE_FRIENDS) return; // fixed name
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

/** Adds or removes a friend from Close Friends (silently), then rotates so only current members hold the new key. */
export async function setCloseFriend(account: StoredAccount, userId: string, on: boolean): Promise<void> {
  const book = await loadAddressBook(account);
  if (!book.contacts[userId] || !!book.contacts[userId].closeFriend === on) return;
  await updateAddressBook(account, (b) => {
    if (b.contacts[userId]) b.contacts[userId].closeFriend = on;
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
 * Starts a new epoch: fresh C1 (and so a fresh Close Friends key) and profile key, a re-wrapped payload for every
 * friend at their circle, profile re-encrypted. The new epoch is saved to the encrypted address book before anything
 * else, so an interruption never loses it; `resumePendingRotation` finishes the job.
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

/**
 * Finishes an interrupted rotation, and moves an address book from the old circle layout once (call on startup and
 * when opening Circles). Returns whether anything ran.
 */
export async function resumePendingRotation(account: StoredAccount): Promise<boolean> {
  const book = await loadAddressBook(account);
  if (book.circlesLayout !== 2) {
    await migrateCircleLayout(account);
    return true;
  }
  if (!book.pendingRotation) return false;
  await withRetry(() => finishRotation(account));
  return true;
}

/** Old books used circles 1–10: move everyone to the new positions, then rotate so their keys match. */
async function migrateCircleLayout(account: StoredAccount): Promise<void> {
  await updateAddressBook(account, (b) => {
    if (b.circlesLayout === 2) return;
    for (const c of Object.values(b.contacts)) c.circle = migratedCircle(c.circle);
    for (const [id, n] of Object.entries(b.postCircles ?? {})) b.postCircles![id] = migratedCircle(n);
    if (b.lastCircle !== undefined) b.lastCircle = migratedCircle(b.lastCircle);
    delete b.labels; // the old names were for the old positions
    b.circlesLayout = 2;
  });
  const book = await loadAddressBook(account);
  if (book.myEpochs.length > 0) await rotateEpoch(account);
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
  // Each payload is wrapped for the circle and Close Friends membership in this snapshot; that's what's recorded below.
  const wrapped = recipients.flatMap((f) => {
    const c = book.contacts[f.userId!];
    if (!c || c.identityChanged) return [];
    const close = !!c.closeFriend;
    return [{ toUserId: f.userId!, circle: c.circle, close, ciphertext: friendPayload(account, epoch, f.userId!, c.x25519, c.circle, close) }];
  });
  const payloads = wrapped.map(({ toUserId, ciphertext }) => ({ toUserId, epochId: epoch.epochId, ciphertext }));
  for (let i = 0; i < payloads.length; i += 200) {
    ok(await api.PUT('/v1/friend-payloads/batch', { body: { payloads: payloads.slice(i, i + 200) } }));
  }

  // Re-encrypt my profile under the new profile key (ex-friends lose access to future profile changes).
  const profile = await loadMyProfile(account);
  if (profile) await saveMyProfile(account, profile);

  let changedMeanwhile = false;
  await updateAddressBook(account, (b) => {
    for (const p of wrapped) {
      recordPlacement(b, epoch.epochId, p.toUserId, p.circle, p.close);
      const now = b.contacts[p.toUserId];
      if (now && (now.circle !== p.circle || !!now.closeFriend !== p.close)) changedMeanwhile = true;
    }
    if (b.pendingRotation?.epochId === epoch.epochId) delete b.pendingRotation;
  });
  // Someone was moved while this ran: their keys in this epoch don't match their circle, so rotate again.
  if (changedMeanwhile) await rotateEpoch(account);
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
