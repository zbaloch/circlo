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
  /** Author-only: who was given the Close Friends key (CRYPTO.md 8.5) in this epoch. */
  closeFriends?: string[];
};

/** Keys a friend gave me for one of their epochs. `exclusiveKey`: their Close Friends slot (real key or filler; absent for v1). */
export type FriendKey = { epochId: string; circleKey: string; profileKey: string; exclusiveKey?: string };

export type Contact = {
  /** Identity keys pinned at first contact (base64). A different key from the server triggers a warning. */
  ed25519: string;
  x25519: string;
  identityVersion: number;
  verified: boolean;
  /** Set when the server starts publishing different identity keys; cleared only after re-verification. */
  identityChanged?: { ed25519: string; x25519: string; version: number };
  /** Author-only: the circle I placed this friend in (never shown to them). Phase 6 adds the UI. */
  circle: number;
  /** Author-only: in my Close Friends (an exclusive circle, CRYPTO.md 8.5), on top of their chain circle. */
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
  /** Author-only circle names (1–100). Missing entries fall back to DEFAULT_LABELS. Never leaves this device unencrypted. */
  labels?: Record<string, string>;
  /** A rotation that started but hasn't finished re-wrapping for everyone; resumed automatically. */
  pendingRotation?: { epochId: string; startedAt: string };
  /** Author-only: which circle each of my posts went to (the post header deliberately doesn't say). */
  postCircles?: Record<string, number>;
  /** The composer's remembered audience. */
  lastCircle?: number;
  /** Circle positions in use: 2 = defaults at 20/40/60/80/100 (CRYPTO.md 8.5). Older books are migrated once. */
  circlesLayout?: 2;
  /** Authors whose posts I hide from my timeline (local preference; the server never learns it). */
  muted?: string[];
};

/** New contacts start in the widest circle ("Everyone") until the author places them. */
export const DEFAULT_CIRCLE = 100;

/** Where a new friend goes unless I pick another circle: "Friends" (owner decisions 2026-10-28). */
export const NEW_FRIEND_CIRCLE = 80;

/** Audience value for a post to Close Friends: not a chain position (those are 1–100). */
export const CLOSE_FRIENDS = 0;

const empty = (): AddressBook => ({ v: 1, myEpochs: [], contacts: {}, circlesLayout: 2 });

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

/** Notes which circle a friend was given in an epoch (used by "Preview as…"). Call inside `updateAddressBook`. */
export function recordPlacement(book: AddressBook, epochId: string, userId: string, circle: number, closeFriend = false) {
  const epoch = book.myEpochs.find((e) => e.epochId === epochId);
  if (!epoch) return;
  epoch.placements = { ...epoch.placements, [userId]: circle };
  const others = (epoch.closeFriends ?? []).filter((id) => id !== userId);
  epoch.closeFriends = closeFriend ? [...others, userId] : others;
}
