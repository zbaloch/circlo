/**
 * Friends (PLAN.md Phase 5, CRYPTO.md sections 8.3, 10, 12). Every cryptographic step is a call into the core; the
 * server only relays ciphertext and never learns names, profiles, circles or keys.
 */
import * as Core from '@circlo/core';

import { api, ok } from '@/api/client';

import {
  compareIdentity,
  currentEpoch,
  DEFAULT_CIRCLE,
  loadAddressBook,
  NEW_FRIEND_CIRCLE,
  recordPlacement,
  updateAddressBook,
  type AddressBook,
  type Contact,
  type MyEpoch,
} from './addressbook';
import { equalBytes, fromB64, toB64, utf8, uuidFromRandom, uuidToBytes } from './bytes';
import type { StoredAccount } from './keystore';

export const INVITE_HOST = 'https://circlo.com/i/';

export type Profile = { displayName: string; bio: string; handle: string };

export type Identity = { x25519Pub: string; ed25519Pub: string; signature: string; version: number };

function myIdentity(a: StoredAccount): Core.IdentityKeys {
  return { x25519Sk: fromB64(a.x25519Sk), x25519Pk: fromB64(a.x25519Pk), ed25519Sk: fromB64(a.ed25519Sk), ed25519Pk: fromB64(a.ed25519Pk) };
}

export function b64url(data: ArrayBuffer): string {
  return toB64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** Parses `https://circlo.com/i/<token>#<fingerprint>` (or `circlo://i/...`). Pure; returns null if malformed. */
export function parseInviteLink(link: string): { token: ArrayBuffer; fingerprint: ArrayBuffer } | null {
  const m = link.trim().match(/^(?:https:\/\/circlo\.com|circlo:\/)\/i\/([A-Za-z0-9_-]{43})#([A-Za-z0-9_-]{22})$/);
  if (!m) return null;
  try {
    const token = fromB64url(m[1]);
    const fingerprint = fromB64url(m[2]);
    return token.byteLength === 32 && fingerprint.byteLength === 16 ? { token, fingerprint } : null;
  } catch {
    return null;
  }
}

// ---------------- my epoch and profile ----------------

/** Makes sure I have an active epoch (C1 + profile key) registered on the server and stored in my address book. */
export async function ensureEpoch(account: StoredAccount): Promise<MyEpoch> {
  const existing = currentEpoch(await loadAddressBook(account));
  if (existing) return existing;
  const epoch: MyEpoch = {
    epochId: uuidFromRandom(Core.newSymmetricKey()),
    root: toB64(Core.newSymmetricKey()),
    profileKey: toB64(Core.newSymmetricKey()),
    createdAt: new Date().toISOString(),
  };
  ok(await api.POST('/v1/epochs', { body: { epochId: epoch.epochId } }));
  await updateAddressBook(account, (b) => {
    b.myEpochs.push(epoch);
  });
  await saveMyProfile(account, { displayName: account.handle, bio: '', handle: account.handle });
  return epoch;
}

export async function loadMyProfile(account: StoredAccount): Promise<Profile | null> {
  const book = await loadAddressBook(account);
  const res = await api.GET('/v1/blobs/{kind}', { params: { path: { kind: 'profile' } } });
  if (res.response.status === 404) return null;
  const blob = ok(res);
  // The profile may still be sealed under the previous epoch while a rotation is finishing.
  const epoch = book.myEpochs.find((e) => e.epochId === blob.epochId);
  if (!epoch) return null;
  return decryptProfile(account.userId, blob.epochId!, blob.ciphertext, epoch.profileKey);
}

/** Encrypts the profile with the current epoch's profile key (only friends of this epoch can read it). */
export async function saveMyProfile(account: StoredAccount, profile: Profile): Promise<void> {
  const epoch = currentEpoch(await loadAddressBook(account));
  if (!epoch) throw new Error('no epoch');
  const existing = await api.GET('/v1/blobs/{kind}', { params: { path: { kind: 'profile' } } });
  const version = existing.response.status === 404 ? 1 : ok(existing).version + 1;
  const ciphertext = Core.sealProfile(fromB64(epoch.profileKey), uuidToBytes(account.userId), uuidToBytes(epoch.epochId), utf8(JSON.stringify(profile)));
  ok(
    await api.PUT('/v1/blobs/{kind}', {
      params: { path: { kind: 'profile' } },
      body: { epochId: epoch.epochId, ciphertext: toB64(ciphertext), version },
    }),
  );
}

function decryptProfile(userId: string, epochId: string, ciphertext: string, profileKey: string): Profile {
  const plain = Core.openProfile(fromB64(profileKey), uuidToBytes(userId), uuidToBytes(epochId), fromB64(ciphertext));
  return JSON.parse(new TextDecoder().decode(plain)) as Profile;
}

// ---------------- invites ----------------

/** Creates a single-use invite. The server only stores the token's hash; the fingerprint is never sent to it. */
export async function createInviteLink(account: StoredAccount): Promise<string> {
  await ensureEpoch(account);
  const token = Core.newSymmetricKey();
  ok(await api.POST('/v1/invites', { body: { tokenHash: toB64(Core.inviteTokenHash(token)) } }));
  const fingerprint = Core.identityFingerprint(fromB64(account.ed25519Pk), fromB64(account.x25519Pk));
  return `${INVITE_HOST}${b64url(token)}#${b64url(fingerprint)}`;
}

export class InviteError extends Error {}

/** Redeems an invite, checks the inviter's keys against the link's fingerprint, then sends a friend request. */
/** Redeems an invite (link or QR) and sends my request, placing them in `circle` (2–100). */
export async function acceptInvite(account: StoredAccount, link: string, circle: number = NEW_FRIEND_CIRCLE): Promise<string> {
  assertFriendCircle(circle);
  const parsed = parseInviteLink(link);
  if (!parsed) throw new InviteError('That isn’t a Circlo invite link.');
  const res = await api.POST('/v1/invites/redeem', { body: { token: toB64(parsed.token) } });
  if (res.response.status === 404) throw new InviteError('This invite has expired or was already used. Ask for a new one.');
  if (res.response.status === 400) throw new InviteError('That’s your own invite.');
  const inviter = ok(res);
  const identity = inviter.identity as Identity;
  const fp = Core.identityFingerprint(fromB64(identity.ed25519Pub), fromB64(identity.x25519Pub));
  if (!equalBytes(fp, parsed.fingerprint)) {
    // The server returned keys that don't belong to the person who made this invite.
    throw new InviteError('This invite doesn’t match the keys Circlo returned. Don’t continue; ask your friend to show their code in person.');
  }
  verifyIdentitySignature(inviter.userId!, identity);
  await sendRequest(account, inviter.userId!, identity, circle);
  return inviter.userId!;
}

export function verifyIdentitySignature(userId: string, id: Identity) {
  Core.verifyIdentity(fromB64(id.ed25519Pub), uuidToBytes(userId), id.version, fromB64(id.x25519Pub), fromB64(id.signature));
}

export function friendPayload(account: StoredAccount, epoch: MyEpoch, toUserId: string, theirX25519: string, circle: number): string {
  return toB64(
    Core.sealFriendPayload(
      myIdentity(account),
      fromB64(theirX25519),
      uuidToBytes(account.userId),
      uuidToBytes(toUserId),
      uuidToBytes(epoch.epochId),
      fromB64(epoch.root),
      circle,
      fromB64(epoch.profileKey),
    ),
  );
}

async function pin(account: StoredAccount, userId: string, id: Identity) {
  await updateAddressBook(account, (b) => {
    if (!b.contacts[userId]) {
      b.contacts[userId] = { ed25519: id.ed25519Pub, x25519: id.x25519Pub, identityVersion: id.version, verified: false, circle: DEFAULT_CIRCLE, keys: [] };
    }
  });
}

function assertFriendCircle(circle: number) {
  if (!Number.isInteger(circle) || circle < 2 || circle > 100) throw new Error('invalid circle');
}

/** Sends my request with my keys for `circle`, and records where I placed them (author-only). */
async function sendRequest(account: StoredAccount, toUserId: string, identity: Identity, circle: number) {
  const epoch = await ensureEpoch(account);
  await pin(account, toUserId, identity);
  ok(
    await api.POST('/v1/friends/requests', {
      body: { toUserId, epochId: epoch.epochId, payload: friendPayload(account, epoch, toUserId, identity.x25519Pub, circle) },
    }),
  );
  await updateAddressBook(account, (b) => {
    if (b.contacts[toUserId]) b.contacts[toUserId].circle = circle;
    recordPlacement(b, epoch.epochId, toUserId, circle);
  });
}

// ---------------- requests and friends ----------------

export type Connection = {
  userId: string;
  status: 'incoming' | 'outgoing' | 'accepted';
  profile?: Profile;
  verified: boolean;
  identityChanged: boolean;
};

/** Fetches connections and, for everyone who sent me keys, opens their payload and profile. */
export async function syncConnections(account: StoredAccount): Promise<Connection[]> {
  const list = ok(await api.GET('/v1/friends'));
  const out: Connection[] = [];
  for (const f of list) {
    const userId = f.userId!;
    const status = f.status as Connection['status'];
    let profile: Profile | undefined;
    let contact: Contact | undefined;
    if (status !== 'outgoing') {
      contact = await refreshContact(account, userId);
      const key = contact?.keys[contact.keys.length - 1];
      if (key) {
        const blob = await api.GET('/v1/users/{userId}/profile', { params: { path: { userId } } });
        if (blob.response.ok) {
          const b = ok(blob);
          const k = contact!.keys.find((x) => x.epochId === b.epochId) ?? key;
          try {
            profile = decryptProfile(userId, b.epochId!, b.ciphertext, k.profileKey);
          } catch {
            profile = undefined; // profile from an epoch I don't hold (e.g. moved outward) stays unreadable
          }
        }
      }
    } else {
      contact = (await loadAddressBook(account)).contacts[userId];
    }
    if (profile && contact && (contact.displayName !== profile.displayName || contact.handle !== profile.handle)) {
      await updateAddressBook(account, (b) => {
        const c = b.contacts[userId];
        if (c) {
          c.displayName = profile!.displayName;
          c.handle = profile!.handle;
        }
      });
    }
    out.push({ userId, status, profile, verified: !!contact?.verified, identityChanged: !!contact?.identityChanged });
  }
  return out;
}

/** Re-checks a connection's identity against the pin and stores any keys they've sent me. */
export async function refreshContact(account: StoredAccount, userId: string): Promise<Contact | undefined> {
  const id = ok(await api.GET('/v1/users/{userId}/identity', { params: { path: { userId } } })) as Identity;
  verifyIdentitySignature(userId, id);
  const payloads = ok(await api.GET('/v1/friend-payloads', { params: { query: { from: userId } } }));
  const book = await updateAddressBook(account, (b) => {
    const c = b.contacts[userId];
    const verdict = compareIdentity(c, { ed25519: id.ed25519Pub, x25519: id.x25519Pub });
    if (verdict === 'new') {
      b.contacts[userId] = { ed25519: id.ed25519Pub, x25519: id.x25519Pub, identityVersion: id.version, verified: false, circle: DEFAULT_CIRCLE, keys: [] };
    } else if (verdict === 'changed') {
      // Never silently trust new keys: keep the pin, flag the change, drop verification.
      c!.identityChanged = { ed25519: id.ed25519Pub, x25519: id.x25519Pub, version: id.version };
      c!.verified = false;
      return;
    }
    const contact = b.contacts[userId]!;
    for (const p of payloads) {
      if (contact.keys.some((k) => k.epochId === p.epochId)) continue;
      try {
        const key = Core.openFriendPayload(myIdentity(account), fromB64(contact.x25519), uuidToBytes(userId), uuidToBytes(account.userId), uuidToBytes(p.epochId!), fromB64(p.ciphertext!));
        contact.keys.push({ epochId: p.epochId!, circleKey: toB64(key.circleKey), profileKey: toB64(key.profileKey) });
      } catch {
        // Not from the pinned identity (or tampered): ignore it.
      }
    }
  });
  return book.contacts[userId];
}

/** Accepts a request and places them in `circle` (2–100; circle 1 is "Me only"). Their key payload is for that circle. */
export async function acceptRequest(account: StoredAccount, userId: string, circle: number = NEW_FRIEND_CIRCLE): Promise<void> {
  assertFriendCircle(circle);
  const contact = await refreshContact(account, userId);
  if (!contact || contact.identityChanged) throw new InviteError('This person’s security keys changed. Verify them before accepting.');
  const epoch = await ensureEpoch(account);
  ok(
    await api.POST('/v1/friends/{userId}/accept', {
      params: { path: { userId } },
      body: { epochId: epoch.epochId, payload: friendPayload(account, epoch, userId, contact.x25519, circle) },
    }),
  );
  await updateAddressBook(account, (b) => {
    if (b.contacts[userId]) b.contacts[userId].circle = circle;
    recordPlacement(b, epoch.epochId, userId, circle);
  });
}

export async function declineRequest(userId: string): Promise<void> {
  ok(await api.POST('/v1/friends/{userId}/decline', { params: { path: { userId } } }));
}

// ---------------- safety numbers and identity changes ----------------

export function safetyNumber(account: StoredAccount, userId: string, contact: Contact): { groups: string[]; qr: string } {
  const sn = Core.safetyNumber(
    uuidToBytes(account.userId),
    fromB64(account.ed25519Pk),
    fromB64(account.x25519Pk),
    uuidToBytes(userId),
    fromB64(contact.ed25519),
    fromB64(contact.x25519),
  );
  return { groups: sn.digits.match(/.{5}/g) ?? [], qr: toB64(sn.qr) };
}

export async function setVerified(account: StoredAccount, userId: string, verified: boolean) {
  await updateAddressBook(account, (b) => {
    if (b.contacts[userId]) b.contacts[userId].verified = verified;
  });
}

/** After checking the new safety number with the friend, adopt their new keys. */
export async function acceptNewIdentity(account: StoredAccount, userId: string) {
  await updateAddressBook(account, (b) => {
    const c = b.contacts[userId];
    if (c?.identityChanged) {
      c.ed25519 = c.identityChanged.ed25519;
      c.x25519 = c.identityChanged.x25519;
      c.identityVersion = c.identityChanged.version;
      delete c.identityChanged;
      c.verified = false;
    }
  });
}

export async function getContact(account: StoredAccount, userId: string): Promise<Contact | undefined> {
  const book: AddressBook = await loadAddressBook(account);
  return book.contacts[userId];
}
