/**
 * Onboarding flows (PLAN.md Phase 4, CRYPTO.md sections 5–7). Every cryptographic step is a call into the Rust core;
 * this module only sequences them and talks to the API. The server never receives the password, the recovery phrase,
 * a handle at rest, or any private key.
 */
import * as Core from '@halqo/core';

import { api, ok, setAccessToken, withToken } from '@/api/client';

import { equalBytes, fromB64, toB64, utf8, uuidFromRandom, uuidToBytes } from './bytes';
import { saveAccount, type StoredAccount } from './keystore';

export type Tokens = { userId: string; accessToken: string; refreshToken: string };

/** Human-readable messages for failures; never includes secrets. */
export function describeError(e: unknown): string {
  const code = (e as { code?: string })?.code;
  switch (code) {
    case 'handle_taken':
      return 'That handle is taken. Try another.';
    case 'invalid_handle':
      return 'Handles are 3–30 characters: letters, numbers and _.';
    case 'registration_expired':
      return 'This signup expired before it was finished, so nothing was saved. Please start again.';
    case 'rate_limited':
      return 'Too many attempts. Wait a minute and try again.';
    case 'unauthorized':
      return 'Wrong handle or password.';
  }
  const tag = (e as { tag?: string })?.tag;
  if (tag === 'AuthFailed') return 'Wrong handle or password.';
  if (tag === 'InvalidInput') return 'Please check what you entered.';
  if (e instanceof TypeError) return 'Can’t reach the Halqo server. Check your connection.';
  return 'Something went wrong. Please try again.';
}

export const MIN_PASSWORD = 10;

function newId(): string {
  return uuidFromRandom(Core.newSymmetricKey());
}

/** Validates locally (no network). Returns the normalized handle or throws InvalidInput. */
export function normalizeHandle(handle: string): string {
  return Core.normalizeHandle(handle);
}

// ---------------- sign up ----------------

/**
 * A signup in progress. Created after the handle is reserved and OPAQUE registration is computed; finished after the
 * user confirms three words of the recovery phrase. Nothing is stored on the device until `finish` succeeds.
 */
export class Signup {
  private constructor(
    readonly handle: string,
    readonly userId: string,
    private readonly registrationUpload: ArrayBuffer,
    private readonly exportKey: ArrayBuffer,
    private readonly identity: Core.IdentityKeys,
    private readonly recovery: Core.RecoveryPhrase,
  ) {}

  static async start(rawHandle: string, password: string): Promise<Signup> {
    const handle = Core.normalizeHandle(rawHandle);
    const reg = new Core.OpaqueClientRegistration(utf8(password));
    const start = ok(
      await api.POST('/v1/auth/register/start', { body: { handle, registrationRequest: toB64(reg.request()) } }),
    );
    const fin = reg.finish(handle, fromB64(start.registrationResponse!));
    return new Signup(handle, start.userId!, fin.message, fin.exportKey, Core.generateIdentity(), Core.newRecoveryPhrase());
  }

  get words(): string[] {
    return this.recovery.phrase.split(' ');
  }

  async finish(): Promise<StoredAccount> {
    const uid = uuidToBytes(this.userId);
    const deviceId = newId();
    const device = Core.generateDeviceKeys();
    const backup: Core.KeyBackup = {
      x25519Sk: this.identity.x25519Sk,
      ed25519Sk: this.identity.ed25519Sk,
      dataKey: Core.newSymmetricKey(),
      localRoot: Core.newSymmetricKey(),
      epochs: [],
    };
    const tokens = ok(
      await api.POST('/v1/auth/register/finish', {
        body: {
          userId: this.userId,
          handle: this.handle,
          registrationUpload: toB64(this.registrationUpload),
          recoveryPubkey: toB64(Core.recoveryPublicKey(this.recovery.entropy)),
          identity: {
            x25519Pub: toB64(this.identity.x25519Pk),
            ed25519Pub: toB64(this.identity.ed25519Pk),
            signature: toB64(Core.signIdentity(this.identity, uid, 1)),
            version: 1,
          },
          device: {
            deviceId,
            devicePubkey: toB64(device.publicKey),
            deviceCert: toB64(Core.signDeviceCertificate(this.identity, uid, uuidToBytes(deviceId), device.publicKey)),
          },
          passwordBackup: toB64(Core.sealPasswordBackup(this.exportKey, uid, backup)),
          recoveryBackup: toB64(Core.sealRecoveryBackup(this.recovery.entropy, uid, backup)),
        },
      }),
    );
    return persist(this.handle, tokens as Tokens, this.identity, backup, deviceId, device);
  }
}

/** Three distinct 0-based word positions to confirm, drawn from the core's CSPRNG. */
export function pickConfirmPositions(count = 24, picks = 3): number[] {
  const random = new Uint8Array(Core.newSymmetricKey());
  const chosen: number[] = [];
  for (let i = 0; i < random.length && chosen.length < picks; i++) {
    const p = random[i] % count;
    if (!chosen.includes(p)) chosen.push(p);
  }
  return chosen.sort((a, b) => a - b);
}

export function wordsMatch(words: string[], positions: number[], answers: string[]): boolean {
  return positions.every((p, i) => (answers[i] ?? '').trim().toLowerCase() === words[p]);
}

// ---------------- log in on a new device ----------------

export async function login(rawHandle: string, password: string): Promise<StoredAccount> {
  const handle = Core.normalizeHandle(rawHandle);
  const login = new Core.OpaqueClientLogin(utf8(password));
  const start = ok(
    await api.POST('/v1/auth/login/start', { body: { handle, credentialRequest: toB64(login.request()) } }),
  );
  const fin = login.finish(handle, fromB64(start.credentialResponse!)); // throws AuthFailed for a wrong password
  const tokens = ok(
    await api.POST('/v1/auth/login/finish', {
      body: { loginId: start.loginId!, handle, credentialFinalization: toB64(fin.message) },
    }),
  ) as Tokens;
  const auth = withToken(tokens.accessToken);
  const stored = ok(await api.GET('/v1/backups/{kind}', { params: { path: { kind: 'password' } }, ...auth }));
  const backup = Core.openPasswordBackup(fin.exportKey, uuidToBytes(tokens.userId), fromB64(stored.ciphertext));
  return finishOnThisDevice(handle, tokens, backup);
}

// ---------------- recover with the 24 words ----------------

export async function recover(rawHandle: string, phrase: string, newPassword: string): Promise<StoredAccount> {
  const handle = Core.normalizeHandle(rawHandle);
  const entropy = Core.recoveryEntropyFromPhrase(phrase); // rejects typos / bad checksum locally
  const start = ok(await api.POST('/v1/auth/recovery/start', { body: { handle } }));
  const uid = uuidToBytes(start.userId!);
  const signature = Core.signRecoveryLogin(
    entropy,
    uid,
    uuidToBytes(start.challengeId!),
    fromB64(start.nonce!),
    BigInt(start.expiresAt!),
  );
  const recoveryTokens = ok(
    await api.POST('/v1/auth/recovery/finish', { body: { challengeId: start.challengeId!, signature: toB64(signature) } }),
  ) as Tokens;
  const auth = withToken(recoveryTokens.accessToken);
  const stored = ok(await api.GET('/v1/backups/{kind}', { params: { path: { kind: 'recovery' } }, ...auth }));
  const backup = Core.openRecoveryBackup(entropy, uid, fromB64(stored.ciphertext));

  // Set the new password: OPAQUE re-registration + a fresh password copy of the same backup.
  const reg = new Core.OpaqueClientRegistration(utf8(newPassword));
  const ps = ok(
    await api.POST('/v1/auth/password/start', { body: { handle, registrationRequest: toB64(reg.request()) }, ...auth }),
  );
  const fin = reg.finish(handle, fromB64(ps.registrationResponse!));
  const tokens = ok(
    await api.POST('/v1/auth/password/finish', {
      body: {
        registrationUpload: toB64(fin.message),
        passwordBackup: toB64(Core.sealPasswordBackup(fin.exportKey, uid, backup)),
      },
      ...auth,
    }),
  ) as Tokens;
  return finishOnThisDevice(handle, tokens, backup);
}

// ---------------- shared ----------------

/** Rebuilds the identity locally, checks it against the published keys, and registers this device. */
async function finishOnThisDevice(handle: string, tokens: Tokens, backup: Core.KeyBackup): Promise<StoredAccount> {
  const identity = Core.identityFromSecrets(backup.x25519Sk, backup.ed25519Sk);
  const auth = withToken(tokens.accessToken);
  const published = ok(await api.GET('/v1/users/{userId}/identity', { params: { path: { userId: tokens.userId } }, ...auth }));
  if (!equalBytes(fromB64(published.ed25519Pub), identity.ed25519Pk) || !equalBytes(fromB64(published.x25519Pub), identity.x25519Pk)) {
    // The server is publishing keys that don't match our own backup: refuse to continue.
    throw Object.assign(new Error('identity mismatch'), { tag: 'BadSignature' });
  }
  const uid = uuidToBytes(tokens.userId);
  const deviceId = newId();
  const device = Core.generateDeviceKeys();
  ok(
    await api.POST('/v1/devices', {
      body: {
        deviceId,
        devicePubkey: toB64(device.publicKey),
        deviceCert: toB64(Core.signDeviceCertificate(identity, uid, uuidToBytes(deviceId), device.publicKey)),
      },
      ...auth,
    }),
  );
  return persist(handle, tokens, identity, backup, deviceId, device);
}

async function persist(
  handle: string,
  tokens: Tokens,
  identity: Core.IdentityKeys,
  backup: Core.KeyBackup,
  deviceId: string,
  device: Core.SigningKeyPair,
): Promise<StoredAccount> {
  const account: StoredAccount = {
    userId: tokens.userId,
    handle,
    deviceId,
    x25519Sk: toB64(identity.x25519Sk),
    x25519Pk: toB64(identity.x25519Pk),
    ed25519Sk: toB64(identity.ed25519Sk),
    ed25519Pk: toB64(identity.ed25519Pk),
    deviceSk: toB64(device.secretKey),
    devicePk: toB64(device.publicKey),
    dataKey: toB64(backup.dataKey),
    localRoot: toB64(backup.localRoot),
    refreshToken: tokens.refreshToken,
  };
  await saveAccount(account);
  setAccessToken(tokens.accessToken);
  return account;
}

/** Short fingerprint of this account's identity keys, for comparing devices (and later, safety numbers). */
export function fingerprint(account: StoredAccount): ArrayBuffer {
  return Core.identityFingerprint(fromB64(account.ed25519Pk), fromB64(account.x25519Pk));
}
