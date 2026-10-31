/**
 * Face ID / fingerprint recovery (docs/PASSKEY_RECOVERY.md, CRYPTO.md 6.4). A passkey for www.hellocirclo.com lives in the
 * user's iCloud Keychain or Google Password Manager; its PRF output for a fixed salt is the passkey recovery method's
 * root. The server never sees the passkey or the PRF output: it only checks signatures made with a key derived from it
 * (in the core). Challenges here are random because nothing on the server verifies the passkey's own signature.
 */
import * as Core from '@circlo/core';
import { Platform } from 'react-native';
import { Passkey } from 'react-native-passkey';

import { fromAnyB64, toB64Url } from './bytes';

export const RP_ID = 'www.hellocirclo.com';
/** What the system shows to unlock a passkey, for button labels. */
export const BIOMETRIC = Platform.OS === 'ios' ? 'Face ID' : 'your fingerprint';
const ES256 = -7;
const ED25519 = -8;

/** No PRF from this passkey provider (e.g. some third-party password managers): offer the phrase instead. */
export class PasskeyUnavailableError extends Error {
  readonly tag = 'PasskeyUnavailable';
}

/** The user closed the system sheet. Not an error worth showing. */
export function isCancelled(e: unknown): boolean {
  const s = `${(e as { error?: string })?.error ?? ''} ${(e as { message?: string })?.message ?? ''}`;
  return /cancel/i.test(s);
}

/** Whether this phone can do passkey recovery at all: passkeys with PRF need iOS 18+ (Android: provider-dependent). */
export function passkeySupported(): boolean {
  try {
    if (!Passkey.isSupported()) return false;
  } catch {
    return false;
  }
  if (Platform.OS === 'ios') return Number.parseInt(String(Platform.Version), 10) >= 18;
  return Platform.OS === 'android';
}

const challenge = () => toB64Url(Core.newSymmetricKey());
const salt = () => toB64Url(Core.passkeyPrfSalt());

function prfFirst(result: { clientExtensionResults?: { prf?: { results?: { first?: unknown } } } }): ArrayBuffer | null {
  const first = result.clientExtensionResults?.prf?.results?.first;
  if (typeof first !== 'string' || !first) return null;
  const out = fromAnyB64(first);
  return out.byteLength === 32 ? out : null;
}

/** Face ID once more: the PRF output of the user's Circlo passkey (any of them, if there are several). */
export async function passkeyPrf(): Promise<ArrayBuffer> {
  const result = await Passkey.get({
    challenge: challenge(),
    rpId: RP_ID,
    userVerification: 'required',
    extensions: { prf: { eval: { first: salt() } } },
  });
  const prf = prfFirst(result);
  if (!prf) throw new PasskeyUnavailableError('This passkey can’t be used for recovery.');
  return prf;
}

/**
 * Creates the Circlo passkey and returns its PRF output. Some providers only give PRF on `get`, so it asks again if
 * `create` returned none; if both returned one they must match, or recovery couldn't work later.
 */
export async function createRecoveryPasskey(handle: string): Promise<ArrayBuffer> {
  const created = await Passkey.create({
    challenge: challenge(),
    rp: { id: RP_ID, name: 'Circlo' },
    user: { id: toB64Url(Core.newSymmetricKey().slice(0, 16)), name: handle, displayName: handle },
    pubKeyCredParams: [
      { type: 'public-key', alg: ES256 },
      { type: 'public-key', alg: ED25519 },
    ],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none',
    extensions: { prf: { eval: { first: salt() } } },
  });
  const atCreate = prfFirst(created);
  if (created.clientExtensionResults?.prf?.enabled === false) throw new PasskeyUnavailableError('No PRF support.');
  const checked = await passkeyPrf();
  if (atCreate && toB64Url(atCreate) !== toB64Url(checked)) throw new PasskeyUnavailableError('PRF output is unstable.');
  return checked;
}
