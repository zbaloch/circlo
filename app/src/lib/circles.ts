/**
 * Circles (owner decision 2026-10-29): Only me and Everyone are built in, plus up to 8 circles of my own. A friend can
 * be in any number; a post goes to Only me, Everyone, or any set of circles, and a circle's posts reach the people
 * who were in it when they were posted. Circle names and memberships are author-only: nobody is told when they're
 * added, moved or removed, and readers never see a circle label.
 */
import { api, ok } from '@/api/client';

import {
  MAX_CIRCLES,
  refreshAddressBook,
  STARTER_CIRCLES,
  type AddressBook,
  type Audience,
  type CircleDef,
  type Contact,
} from './addressbook';
import type { StoredAccount } from './keystore';

export const ONLY_ME: Audience = { kind: 'onlyMe' };
export const TO_EVERYONE: Audience = { kind: 'everyone' };

// ---------------- pure helpers ----------------

/** My circles, in id order (the starter circles until the server's list has loaded). */
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

const isFriend = (c: Pick<Contact, 'status'>) => c.status === 'accepted';

/** How many friends can see a post to this audience right now. */
export function audienceSize(book: Pick<AddressBook, 'contacts' | 'circleDefs'>, audience: Audience): number {
  if (audience.kind === 'onlyMe') return 0;
  if (audience.kind === 'everyone') return Object.values(book.contacts).filter(isFriend).length;
  return new Set(audience.ids.flatMap((id) => membersOf(book, id)).filter((u) => isFriend(book.contacts[u]))).size;
}

/** "Only me", "Everyone", "Family", "Family, Kids" or "Family +2". */
export function audienceLabel(book: Pick<AddressBook, 'circleDefs'>, audience: Audience): string {
  if (audience.kind === 'onlyMe') return 'Only me';
  if (audience.kind === 'everyone') return 'Everyone';
  const names = [...audience.ids].sort((a, b) => a - b).map((id) => circleName(book, id));
  if (names.length === 0) return 'Circles';
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

/** The server's form of an audience. */
export function apiAudience(audience: Audience): { kind: Audience['kind']; circles: number[] } {
  return { kind: audience.kind, circles: audience.kind === 'circles' ? audience.ids : [] };
}

/** An audience from the server (only ever on my own posts). */
export function fromApiAudience(a: { kind: string; circles?: number[] } | null | undefined): Audience | undefined {
  if (!a) return undefined;
  if (a.kind === 'onlyMe') return ONLY_ME;
  if (a.kind === 'everyone') return TO_EVERYONE;
  return { kind: 'circles', ids: a.circles ?? [] };
}

// ---------------- my circles ----------------

function cleanName(name: string): string {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new Error('A circle needs a name.');
  return clean;
}

export async function createCircle(account: StoredAccount, name: string): Promise<number> {
  const res = await api.POST('/v1/circles', { body: { name: cleanName(name) } });
  if (res.response.status === 409) throw new Error(`You can have up to ${MAX_CIRCLES} circles.`);
  const circle = ok(res);
  await refreshAddressBook(account);
  return circle.id;
}

export async function renameCircle(account: StoredAccount, id: number, name: string): Promise<void> {
  ok(await api.PUT('/v1/circles/{id}', { params: { path: { id } }, body: { name: cleanName(name) } }));
  await refreshAddressBook(account);
}

/** Deletes a circle; posts already shared with it keep the audience they had. */
export async function deleteCircle(account: StoredAccount, id: number): Promise<void> {
  ok(await api.DELETE('/v1/circles/{id}', { params: { path: { id } } }));
  await refreshAddressBook(account);
}

/** Sets a friend's circles. Silent: nobody is told. New posts follow; earlier posts keep their audience. */
export async function setCircles(account: StoredAccount, userId: string, circles: number[]): Promise<void> {
  ok(await api.PUT('/v1/friends/{userId}/circles', { params: { path: { userId } }, body: { circles: [...new Set(circles)].sort((a, b) => a - b) } }));
  await refreshAddressBook(account);
}

/** Removes the friendship: they can't see anything of mine any more, including earlier posts. */
export async function unfriend(account: StoredAccount, userId: string): Promise<void> {
  const res = await api.DELETE('/v1/friends/{userId}', { params: { path: { userId } } });
  if (res.response.status !== 404) ok(res);
  await refreshAddressBook(account);
}
