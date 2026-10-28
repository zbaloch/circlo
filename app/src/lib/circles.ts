/**
 * Circles (CRYPTO.md sections 8.4–8.6, v1.3). Author-only: circle names and memberships live in the encrypted address
 * book and are never shown to anyone else. A post goes to Only me, Everyone (all friends), or one or more circles;
 * a circle's posts reach its members only. Every membership change and every unfriend rotates the epoch, so the
 * server can't tell who moved or how.
 */
import * as Core from '@circlo/core';

import { api, ApiError, ok } from '@/api/client';

import {
  EVERYONE,
  loadAddressBook,
  MAX_CIRCLES,
  recordPlacement,
  STARTER_CIRCLES,
  updateAddressBook,
  type AddressBook,
  type Audience,
  type CircleDef,
  type Contact,
  type MyEpoch,
} from './addressbook';
import { toB64, uuidFromRandom } from './bytes';
import { friendPayload, loadMyProfile, saveMyProfile } from './friends';
import type { StoredAccount } from './keystore';

export const ONLY_ME: Audience = { kind: 'onlyMe' };
export const TO_EVERYONE: Audience = { kind: 'everyone' };

// ---------------- pure helpers (tested without the core) ----------------

/** My circles, in id order (the starter circles until the address book has its own). */
export function circleDefs(book: Pick<AddressBook, 'circleDefs'>): CircleDef[] {
  return [...(book.circleDefs ?? STARTER_CIRCLES)].sort((a, b) => a.id - b.id);
}

export function circleName(book: Pick<AddressBook, 'circleDefs'>, id: number): string {
  return circleDefs(book).find((c) => c.id === id)?.name ?? 'Circle';
}

/** The circles a friend is in (only ones that still exist). */
export function circlesOf(book: Pick<AddressBook, 'circleDefs'>, contact: Pick<Contact, 'circles'> | undefined): number[] {
  const ids = new Set(circleDefs(book).map((c) => c.id));
  return (contact?.circles ?? []).filter((id) => ids.has(id)).sort((a, b) => a - b);
}

/** Friends in this circle. */
export function membersOf(book: Pick<AddressBook, 'contacts' | 'circleDefs'>, id: number): string[] {
  return Object.entries(book.contacts)
    .filter(([, c]) => circlesOf(book, c).includes(id))
    .map(([userId]) => userId);
}

/** How many friends can read a post to this audience. */
export function audienceSize(book: Pick<AddressBook, 'contacts' | 'circleDefs'>, audience: Audience): number {
  if (audience.kind === 'onlyMe') return 0;
  if (audience.kind === 'everyone') return Object.keys(book.contacts).length;
  return new Set(audience.ids.flatMap((id) => membersOf(book, id))).size;
}

/** "Only me", "Everyone", "Family", "Family, Kids" or "Family +2". */
export function audienceLabel(book: Pick<AddressBook, 'circleDefs'>, audience: Audience): string {
  if (audience.kind === 'onlyMe') return 'Only me';
  if (audience.kind === 'everyone') return 'Everyone';
  const names = [...audience.ids].sort((a, b) => a - b).map((id) => circleName(book, id));
  return names.length <= 2 ? names.join(', ') : `${names[0]} +${names.length - 1}`;
}

/** A usable audience: circles must exist, without repeats; an empty circle choice isn't one. */
export function validAudience(book: Pick<AddressBook, 'circleDefs'>, audience: Audience): boolean {
  if (audience.kind !== 'circles') return true;
  const ids = new Set(circleDefs(book).map((c) => c.id));
  return audience.ids.length > 0 && audience.ids.every((id) => ids.has(id)) && new Set(audience.ids).size === audience.ids.length;
}

export function nextCircleId(book: Pick<AddressBook, 'circleDefs'>): number | null {
  const used = new Set(circleDefs(book).map((c) => c.id));
  for (let id = 1; id <= MAX_CIRCLES; id++) if (!used.has(id)) return id;
  return null;
}

/** The core's form of an audience. */
export function coreAudience(audience: Audience): Core.Audience {
  if (audience.kind === 'onlyMe') return new Core.Audience.OnlyMe();
  if (audience.kind === 'everyone') return new Core.Audience.Everyone();
  return new Core.Audience.Circles({ ids: Uint8Array.from(audience.ids).buffer });
}

/**
 * A friend's circles under the older nested layouts (v1.2 positions 20/40/60/80/100, or the first layout's 1–10), as
 * v1.3 circles: My person → Close Friends and Family; Kids → Kids; Parents & siblings → Family; anyone in Close
 * Friends stays there; Friends and Everyone → no circle (they still see Everyone posts).
 */
export function migratedCircles(contact: Pick<Contact, 'circle' | 'closeFriend'>, layout: AddressBook['circlesLayout']): number[] {
  const old = contact.circle;
  // The first layout's 1–10 → v1.2 positions.
  const position = layout === 2 ? old : old <= 1 ? 1 : old === 2 ? 20 : old <= 4 ? 40 : old <= 6 ? 60 : old <= 9 ? 80 : 100;
  const ids = new Set<number>();
  if (position <= 20) [1, 2].forEach((id) => ids.add(id));
  else if (position <= 40) ids.add(3);
  else if (position <= 60) ids.add(2);
  if (contact.closeFriend) ids.add(1);
  return [...ids].sort((a, b) => a - b);
}

// ---------------- my circles ----------------

export async function createCircle(account: StoredAccount, name: string): Promise<number> {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error('A circle needs a name.');
  let id: number | null = null;
  await updateAddressBook(account, (b) => {
    id = nextCircleId(b);
    if (id === null) throw new Error(`You can have up to ${MAX_CIRCLES} circles.`);
    b.circleDefs = [...circleDefs(b), { id, name: clean }];
  });
  return id!;
}

export async function renameCircle(account: StoredAccount, id: number, name: string): Promise<void> {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error('A circle needs a name.');
  await updateAddressBook(account, (b) => {
    b.circleDefs = circleDefs(b).map((c) => (c.id === id ? { ...c, name: clean } : c));
  });
}

/** Deletes a circle: its members lose its key (rotation); posts already shared with it stay as they were. */
export async function deleteCircle(account: StoredAccount, id: number): Promise<void> {
  const book = await loadAddressBook(account);
  const hadMembers = membersOf(book, id).length > 0;
  await updateAddressBook(account, (b) => {
    b.circleDefs = circleDefs(b).filter((c) => c.id !== id);
    for (const c of Object.values(b.contacts)) c.circles = (c.circles ?? []).filter((x) => x !== id);
    if (b.lastAudience?.kind === 'circles') {
      const ids = b.lastAudience.ids.filter((x) => x !== id);
      b.lastAudience = ids.length ? { kind: 'circles', ids } : ONLY_ME;
    }
  });
  // A new circle reusing this id must not share a key with its old members.
  if (hadMembers) await rotateEpoch(account);
}

// ---------------- memberships and rotation ----------------

/** Sets a friend's circles (silently: nobody is told), then rotates so only current members hold each circle's key. */
export async function setCircles(account: StoredAccount, userId: string, circles: number[]): Promise<void> {
  const book = await loadAddressBook(account);
  const contact = book.contacts[userId];
  if (!contact) return;
  const valid = new Set(circleDefs(book).map((c) => c.id));
  const next = [...new Set(circles)].filter((id) => valid.has(id)).sort((a, b) => a - b);
  if (next.join() === circlesOf(book, contact).join()) return;
  await updateAddressBook(account, (b) => {
    if (b.contacts[userId]) b.contacts[userId].circles = next;
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
 * Starts a new epoch: fresh C1 (so fresh Everyone and circle keys) and profile key, a re-wrapped payload for every
 * friend with their circles, profile re-encrypted. The new epoch is saved to the encrypted address book before
 * anything else, so an interruption never loses it; `resumePendingRotation` finishes the job.
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
 * Finishes an interrupted rotation, and moves an address book from an older circle layout once (call on startup and
 * when opening Circles). Returns whether anything ran.
 */
export async function resumePendingRotation(account: StoredAccount): Promise<boolean> {
  const book = await loadAddressBook(account);
  if (book.circlesLayout !== 3) {
    await migrateToCircles(account);
    return true;
  }
  if (!book.pendingRotation) return false;
  await withRetry(() => finishRotation(account));
  return true;
}

/** Older books (nested circles): give everyone their v1.3 circles and the Everyone key, add the starter circles, rotate. */
async function migrateToCircles(account: StoredAccount): Promise<void> {
  await updateAddressBook(account, (b) => {
    if (b.circlesLayout === 3) return;
    for (const c of Object.values(b.contacts)) {
      c.circles = migratedCircles(c, b.circlesLayout);
      c.circle = EVERYONE;
      delete c.closeFriend;
    }
    b.circleDefs = b.circleDefs ?? STARTER_CIRCLES;
    delete b.labels;
    delete b.postCircles; // named nested circles that no longer exist
    delete b.lastCircle;
    b.lastAudience = b.lastAudience ?? ONLY_ME;
    b.circlesLayout = 3;
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
  // Each payload carries the circles in this snapshot; that's what's recorded below.
  const wrapped = recipients.flatMap((f) => {
    const c = book.contacts[f.userId!];
    if (!c || c.identityChanged) return [];
    const circles = circlesOf(book, c);
    return [{ toUserId: f.userId!, circles, ciphertext: friendPayload(account, epoch, f.userId!, c.x25519, circles) }];
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
      recordPlacement(b, epoch.epochId, p.toUserId, p.circles);
      const now = b.contacts[p.toUserId];
      if (now && circlesOf(b, now).join() !== p.circles.join()) changedMeanwhile = true;
    }
    if (b.pendingRotation?.epochId === epoch.epochId) delete b.pendingRotation;
  });
  // Someone's circles changed while this ran: their keys in this epoch don't match, so rotate again.
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
