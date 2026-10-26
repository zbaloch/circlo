/**
 * The encrypted address book (CRYPTO.md 6.1 v1.1 note, section 10): my epoch secrets, friends' received keys, pinned
 * identity keys and verification state. Sealed with data_key before it leaves the device; the server stores ciphertext.
 */
import * as Core from '@halqo/core';

import { api, ApiError, ok } from '@/api/client';

import { fromB64, toB64, utf8, uuidToBytes } from './bytes';
import type { StoredAccount } from './keystore';

export type MyEpoch = { epochId: string; root: string; profileKey: string; createdAt: string };

export type FriendKey = { epochId: string; circleKey: string; profileKey: string };

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
};

/** New friends start in the widest circle until the author places them (Phase 6). */
export const DEFAULT_CIRCLE = 100;

const empty = (): AddressBook => ({ v: 1, myEpochs: [], contacts: {} });

let cache: { book: AddressBook; version: number } | null = null;

export function resetAddressBookCache() {
  cache = null;
}

export async function loadAddressBook(account: StoredAccount): Promise<AddressBook> {
  if (cache) return cache.book;
  const res = await api.GET('/v1/blobs/{kind}', { params: { path: { kind: 'address_book' } } });
  if (res.response.status === 404) {
    cache = { book: empty(), version: 0 };
    return cache.book;
  }
  const blob = ok(res);
  const plain = Core.openUserBlob(fromB64(account.dataKey), Core.BlobKind.AddressBook, uuidToBytes(account.userId), fromB64(blob.ciphertext));
  cache = { book: JSON.parse(new TextDecoder().decode(plain)) as AddressBook, version: blob.version };
  return cache.book;
}

/** Applies `change` to the latest address book and saves it (retries once if another device wrote first). */
export async function updateAddressBook(account: StoredAccount, change: (b: AddressBook) => void): Promise<AddressBook> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const book = JSON.parse(JSON.stringify(await loadAddressBook(account))) as AddressBook;
    change(book);
    const version = (cache?.version ?? 0) + 1;
    const ciphertext = Core.sealUserBlob(fromB64(account.dataKey), Core.BlobKind.AddressBook, uuidToBytes(account.userId), utf8(JSON.stringify(book)));
    const res = await api.PUT('/v1/blobs/{kind}', {
      params: { path: { kind: 'address_book' } },
      body: { ciphertext: toB64(ciphertext), version },
    });
    if (res.response.status === 409 && attempt === 0) {
      cache = null; // another device saved first: reload and re-apply
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
