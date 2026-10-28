/**
 * The encrypted address book (CRYPTO.md 6.1 v1.1 note, section 10): my epoch secrets, friends' received keys, pinned
 * identity keys and verification state. Sealed with data_key before it leaves the device; the server stores ciphertext.
 */
import * as Core from '@circlo/core';

import { api, ApiError, ok } from '@/api/client';

import { fromB64, toB64, utf8, uuidToBytes } from './bytes';
import type { StoredAccount } from './keystore';

export type MyEpoch = {
  epochId: string;
  root: string;
  profileKey: string;
  createdAt: string;
  /** Author-only: the circle each friend was given keys for in this epoch (fixed: every move rotates the epoch). */
  placements?: Record<string, number>;
  /** Author-only: who was given the Close Friends key in this epoch (v1.2 epochs only). */
  closeFriends?: string[];
  /** Author-only: the circle ids each friend was given keys for in this epoch (v1.3 epochs). */
  circles?: Record<string, number[]>;
};

/** Who a post is for (CRYPTO.md 8.6): only me, all my friends, or one or more of my circles. */
export type Audience = { kind: 'onlyMe' } | { kind: 'everyone' } | { kind: 'circles'; ids: number[] };

/** One of my circles: an id 1–8 (its key slot) and the name only I see. */
export type CircleDef = { id: number; name: string };

/**
 * Keys a friend gave me for one of their epochs. `circleKeys`: their circle slots, concatenated (base64; real keys for
 * circles I'm in, filler for the rest, and I can't tell which). `exclusiveKey`: the single slot of a v1.2 payload.
 */
export type FriendKey = { epochId: string; circleKey: string; profileKey: string; circleKeys?: string; exclusiveKey?: string };

export type Contact = {
  /** Identity keys pinned at first contact (base64). A different key from the server triggers a warning. */
  ed25519: string;
  x25519: string;
  identityVersion: number;
  verified: boolean;
  /** Set when the server starts publishing different identity keys; cleared only after re-verification. */
  identityChanged?: { ed25519: string; x25519: string; version: number };
  /** The chain key position they're given: Everyone (2) from v1.3; their nested circle in older layouts. */
  circle: number;
  /** Author-only: the circles (ids) I put this friend in. Never shown to them. */
  circles?: number[];
  /** Older layout (v1.2): in Close Friends. Migrated into `circles`. */
  closeFriend?: boolean;
  keys: FriendKey[];
  /** Cached from their encrypted profile (display only). */
  displayName?: string;
  handle?: string;
};

export type AddressBook = {
  v: 1;
  myEpochs: MyEpoch[];
  contacts: Record<string, Contact>;
  /** Older layouts: names for nested circle positions. Dropped by the v1.3 migration. */
  labels?: Record<string, string>;
  /** My circles (author-only). Missing until the v1.3 migration; then the starter circles. */
  circleDefs?: CircleDef[];
  /** A rotation that started but hasn't finished re-wrapping for everyone; resumed automatically. */
  pendingRotation?: { epochId: string; startedAt: string };
  /** Older layouts: which nested circle each of my posts went to. Dropped by the v1.3 migration. */
  postCircles?: Record<string, number>;
  /** Author-only: who each of my posts went to (the post itself deliberately doesn't say). */
  postAudiences?: Record<string, Audience>;
  /** Older layouts: the composer's remembered circle. */
  lastCircle?: number;
  /** The composer's remembered audience. */
  lastAudience?: Audience;
  /** Circle layout: 3 = independent circles (CRYPTO.md 8.6). Older books are migrated once. */
  circlesLayout?: 2 | 3;
  /** Authors whose posts I hide from my timeline (local preference; the server never learns it). */
  muted?: string[];
};

/** The chain position every friend gets from v1.3: the Everyone key (CRYPTO.md 8.6). */
export const EVERYONE = 2;

/** Starter circles (owner decision 2026-10-29). Close Friends keeps id 1, as before. */
export const STARTER_CIRCLES: CircleDef[] = [
  { id: 1, name: 'Close Friends' },
  { id: 2, name: 'Family' },
  { id: 3, name: 'Kids' },
  { id: 4, name: 'Work' },
];
export const MAX_CIRCLES = 8;

const empty = (): AddressBook => ({ v: 1, myEpochs: [], contacts: {}, circlesLayout: 3, circleDefs: STARTER_CIRCLES });

let cache: { book: AddressBook; version: number } | null = null;

export function resetAddressBookCache() {
  cache = null;
}

/** The book and the server version it was read at, together, so an edit is always saved against its own base. */
async function loadSnapshot(account: StoredAccount): Promise<{ book: AddressBook; version: number }> {
  if (cache) return cache;
  const res = await api.GET('/v1/blobs/{kind}', { params: { path: { kind: 'address_book' } } });
  if (res.response.status === 404) {
    cache = { book: empty(), version: 0 };
    return cache;
  }
  const blob = ok(res);
  const plain = Core.openUserBlob(fromB64(account.dataKey), Core.BlobKind.AddressBook, uuidToBytes(account.userId), fromB64(blob.ciphertext));
  cache = { book: JSON.parse(new TextDecoder().decode(plain)) as AddressBook, version: blob.version };
  return cache;
}

export async function loadAddressBook(account: StoredAccount): Promise<AddressBook> {
  return (await loadSnapshot(account)).book;
}

// Writes from this device run one at a time: a move, a rotation and a background sync never interleave.
let writes: Promise<unknown> = Promise.resolve();

/**
 * Applies `change` to the latest address book and saves it. The save names the version the change was based on,
 * so the server refuses it (409) if anything else was saved in between; the change is then re-applied to the newer
 * book instead of overwriting it.
 */
export function updateAddressBook(account: StoredAccount, change: (b: AddressBook) => void): Promise<AddressBook> {
  const run = writes.then(() => saveChange(account, change));
  writes = run.catch(() => {});
  return run;
}

async function saveChange(account: StoredAccount, change: (b: AddressBook) => void): Promise<AddressBook> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const base = await loadSnapshot(account);
    const book = JSON.parse(JSON.stringify(base.book)) as AddressBook;
    change(book);
    const version = base.version + 1;
    const ciphertext = Core.sealUserBlob(fromB64(account.dataKey), Core.BlobKind.AddressBook, uuidToBytes(account.userId), utf8(JSON.stringify(book)));
    const res = await api.PUT('/v1/blobs/{kind}', {
      params: { path: { kind: 'address_book' } },
      body: { ciphertext: toB64(ciphertext), version },
    });
    if (res.response.status === 409) {
      cache = null; // something else saved first: reload and re-apply
      continue;
    }
    ok(res);
    cache = { book, version };
    return book;
  }
  throw new ApiError(409, 'version_conflict');
}

export function currentEpoch(book: AddressBook): MyEpoch | undefined {
  return book.myEpochs[book.myEpochs.length - 1];
}

/** Compares a freshly fetched identity with the pinned one. Pure: tested without the core. */
export function compareIdentity(
  contact: Pick<Contact, 'ed25519' | 'x25519'> | undefined,
  fetched: { ed25519: string; x25519: string },
): 'new' | 'same' | 'changed' {
  if (!contact) return 'new';
  return contact.ed25519 === fetched.ed25519 && contact.x25519 === fetched.x25519 ? 'same' : 'changed';
}

/** Records which keys a friend was given in an epoch (used by "See what they can see"). Call inside `updateAddressBook`. */
export function recordPlacement(book: AddressBook, epochId: string, userId: string, circles: number[]) {
  const epoch = book.myEpochs.find((e) => e.epochId === epochId);
  if (!epoch) return;
  epoch.placements = { ...epoch.placements, [userId]: EVERYONE };
  epoch.circles = { ...epoch.circles, [userId]: [...circles].sort((a, b) => a - b) };
}
