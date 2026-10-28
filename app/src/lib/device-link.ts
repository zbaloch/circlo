/**
 * Linking a new device by QR code (PLAN.md Phase 10, CRYPTO.md 13b). The new device shows a QR code with a random
 * link id and a one-time public key; the signed-in device scans it, the user compares a 6-digit code on both screens,
 * and the signed-in device seals the account secrets to that key. The server relays the ciphertext once.
 */
import * as Core from '@circlo/core';

import { api, ok } from '@/api/client';

import { finishOnThisDevice, type Tokens } from './account';
import { fromB64, toB64, uuidToBytes } from './bytes';
import { b64url, fromB64url } from './friends';
import type { StoredAccount } from './keystore';

export const LINK_PREFIX = 'circlo://link/';

export type PendingLink = { linkId: ArrayBuffer; keys: Core.LinkKeyPair; qr: string; code: string };

/** New device: a fresh link id and key, the QR text to show, and the confirmation code. */
export function startLink(): PendingLink {
  const linkId = Core.newSymmetricKey();
  const keys = Core.linkGenerateKeys();
  return {
    linkId,
    keys,
    qr: `${LINK_PREFIX}${b64url(linkId)}#${b64url(keys.publicKey)}`,
    code: Core.linkConfirmationCode(keys.publicKey),
  };
}

/** Parses a link QR (pure). Returns null for anything else. */
export function parseLinkQr(text: string): { linkId: ArrayBuffer; publicKey: ArrayBuffer } | null {
  const m = text.trim().match(/^circlo:\/\/link\/([A-Za-z0-9_-]{43})#([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  try {
    const linkId = fromB64url(m[1]);
    const publicKey = fromB64url(m[2]);
    return linkId.byteLength === 32 && publicKey.byteLength === 32 ? { linkId, publicKey } : null;
  } catch {
    return null;
  }
}

let scanned: string | null = null;

/** The scanner hands the link to the confirm screen in memory (never through a URL, where `#` would be lost). */
export function setScannedLink(qr: string) {
  scanned = qr;
}

export function takeScannedLink(): string | null {
  const s = scanned;
  scanned = null;
  return s;
}

/** Deep-link form `circlo://link-confirm?id=<link_id>&k=<link_pk>` (base64url), equivalent to the QR text. */
export function linkFromParams(id?: string, k?: string): string | null {
  return id && k ? `${LINK_PREFIX}${id}#${k}` : null;
}

/** Signed-in device: the code to compare with the new device's screen before sending anything. */
export function confirmationCodeFor(publicKey: ArrayBuffer): string {
  return Core.linkConfirmationCode(publicKey);
}

/** Signed-in device: seals this account's secrets to the new device's key and hands them to the server once. */
export async function sendLink(account: StoredAccount, linkId: ArrayBuffer, publicKey: ArrayBuffer): Promise<void> {
  const backup: Core.KeyBackup = {
    x25519Sk: fromB64(account.x25519Sk),
    ed25519Sk: fromB64(account.ed25519Sk),
    dataKey: fromB64(account.dataKey),
    localRoot: fromB64(account.localRoot),
    epochs: [], // epoch secrets live in the encrypted address book (CRYPTO.md 6.1 v1.1)
  };
  const sealed = Core.linkSeal(publicKey, linkId, uuidToBytes(account.userId), backup, account.handle);
  ok(await api.POST('/v1/device-links', { body: { linkId: toB64(linkId), sealed: toB64(sealed) } }));
}

/**
 * New device: checks whether the hand-off has arrived. Returns the new account (registered as a new device) or null
 * if it isn't there yet.
 */
export async function pickUpLink(link: PendingLink): Promise<StoredAccount | null> {
  const res = await api.GET('/v1/device-links/{linkId}', { params: { path: { linkId: b64url(link.linkId) } } });
  if (res.response.status === 404) return null;
  const r = ok(res);
  const tokens: Tokens = { userId: r.userId!, accessToken: r.accessToken!, refreshToken: r.refreshToken! };
  const handoff = Core.linkOpen(link.keys.secretKey, link.linkId, uuidToBytes(tokens.userId), fromB64(r.sealed!));
  return finishOnThisDevice(handoff.handle, tokens, handoff.backup);
}
