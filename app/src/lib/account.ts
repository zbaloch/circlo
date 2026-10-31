/**
 * Onboarding flows (PLAN.md Phase 4, CRYPTO.md sections 5–7). Every cryptographic step is a call into the Rust core;
 * this module only sequences them and talks to the API. The server never receives the password, the recovery phrase,
 * a handle at rest, or any private key.
 */
import * as Core from '@circlo/core';

import { api, ApiError, ok, setAccessToken, withToken } from '@/api/client';

import { equalBytes, fromB64, toB64, utf8, uuidFromRandom, uuidToBytes } from './bytes';
import { saveAccount, updateRefreshToken, type StoredAccount } from './keystore';

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
    case 'locked': {
      const wait = (e as { retryAfter?: number }).retryAfter;
      return `Too many wrong passwords, so password login is locked${wait ? ` for ${waitText(wait)}` : ' for now'}. Use your recovery phrase to get in now.`;
    }
    case 'unauthorized':
      return 'Wrong handle or password.';
  }
  const tag = (e as { tag?: string })?.tag;
  if (tag === 'AuthFailed') {
    const { attemptsLeft, lockSeconds } = e as { attemptsLeft?: number; lockSeconds?: number | null };
    if (attemptsLeft === 0) {
      return `Wrong handle or password. Password login is now locked${lockSeconds ? ` for ${waitText(lockSeconds)}` : ''}. Use your recovery phrase to get in now.`;
    }
    if (attemptsLeft !== undefined) {
      return `Wrong handle or password. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left before password login locks for a while.`;
    }
    return 'Wrong handle or password.';
  }
  if (tag === 'InvalidInput') return 'Please check what you entered.';
  if (e instanceof TypeError) return 'Can’t reach the Circlo server. Check your connection.';
  return 'Something went wrong. Please try again.';
}

/** "1 minute", "15 minutes", "1 hour", "24 hours", rounded up. Exported for tests. */
export function waitText(seconds: number): string {
  if (seconds < 3600) {
    const m = Math.max(1, Math.ceil(seconds / 60));
    return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  }
  const h = Math.ceil(seconds / 3600);
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

type LoginStarted = { loginId?: string; credentialResponse?: string; attemptsLeft?: number; lockSeconds?: number | null };

/**
 * Finishes the phone's half of an OPAQUE login. A wrong password fails here (AuthFailed), never on the server, so the
 * error carries what the server said about attempts left and the lock.
 */
function finishLogin(login: Core.OpaqueClientLogin, handle: string, start: LoginStarted) {
  try {
    return login.finish(handle, fromB64(start.credentialResponse!));
  } catch (e) {
    throw Object.assign(e as object, { attemptsLeft: start.attemptsLeft, lockSeconds: start.lockSeconds });
  }
}

function newId(): string {
  return uuidFromRandom(Core.newSymmetricKey());
}

/** Validates locally (no network). Returns the normalized handle or throws InvalidInput. */
export function normalizeHandle(handle: string): string {
  return Core.normalizeHandle(handle);
}

// ---------------- sign up ----------------

/** How the new account can get back in without its password: a passkey (Face ID) or a phrase. */
export type RecoveryChoice = { kind: 'passkey'; prf: ArrayBuffer } | { kind: 'phrase' };

/**
 * A signup in progress. Created after the handle is reserved and OPAQUE registration is computed; finished once a
 * recovery method is set up (Face ID, or the 12-word phrase where that isn't available). Nothing is stored on the device
 * until `finish` succeeds.
 */
export class Signup {
  private readonly backup: Core.KeyBackup;

  private constructor(
    readonly handle: string,
    readonly userId: string,
    private readonly registrationUpload: ArrayBuffer,
    private readonly exportKey: ArrayBuffer,
    private readonly identity: Core.IdentityKeys,
    private readonly recovery: Core.RecoveryPhrase,
  ) {
    this.backup = {
      x25519Sk: identity.x25519Sk,
      ed25519Sk: identity.ed25519Sk,
      dataKey: Core.newSymmetricKey(),
      localRoot: Core.newSymmetricKey(),
      epochs: [],
    };
  }

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

  async finish(choice: RecoveryChoice): Promise<StoredAccount> {
    const uid = uuidToBytes(this.userId);
    const deviceId = newId();
    const device = Core.generateDeviceKeys();
    const backup = this.backup;
    const method =
      choice.kind === 'passkey'
        ? passkeyMethod(choice.prf, uid, backup)
        : phraseMethod(this.recovery.entropy, uid, backup);
    const tokens = ok(
      await api.POST('/v1/auth/register/finish', {
        body: {
          userId: this.userId,
          handle: this.handle,
          registrationUpload: toB64(this.registrationUpload),
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
          recoveryMethods: [method],
        },
      }),
    );
    return persist(this.handle, tokens as Tokens, this.identity, backup, deviceId, device);
  }
}

/** A recovery method as the server stores it: its auth key and its sealed copy of the key backup. */
type RecoveryMethodBody = { kind: 'phrase' | 'passkey'; authPubkey: string; ciphertext: string };

function phraseMethod(root: ArrayBuffer, uid: ArrayBuffer, backup: Core.KeyBackup): RecoveryMethodBody {
  return { kind: 'phrase', authPubkey: toB64(Core.recoveryPublicKey(root)), ciphertext: toB64(Core.sealRecoveryBackup(root, uid, backup)) };
}

function passkeyMethod(prf: ArrayBuffer, uid: ArrayBuffer, backup: Core.KeyBackup): RecoveryMethodBody {
  return { kind: 'passkey', authPubkey: toB64(Core.passkeyRecoveryPublicKey(prf)), ciphertext: toB64(Core.sealPasskeyBackup(prf, uid, backup)) };
}

// ---------------- log in on a new device ----------------

export async function login(rawHandle: string, password: string): Promise<StoredAccount> {
  const handle = Core.normalizeHandle(rawHandle);
  const login = new Core.OpaqueClientLogin(utf8(password));
  const start = ok(
    await api.POST('/v1/auth/login/start', { body: { handle, credentialRequest: toB64(login.request()) } }),
  );
  const fin = finishLogin(login, handle, start);
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

// ---------------- change the password (signed in) ----------------

/**
 * Proves the current password (it unlocks the key backup on this phone), then re-registers OPAQUE with the new one and
 * re-seals the backup. The server signs out every other device; this one keeps going with the new session.
 */
export async function changePassword(account: StoredAccount, current: string, next: string): Promise<void> {
  const handle = Core.normalizeHandle(account.handle);
  const uid = uuidToBytes(account.userId);
  const login = new Core.OpaqueClientLogin(utf8(current));
  const start = ok(
    await api.POST('/v1/auth/password/verify/start', { body: { handle, credentialRequest: toB64(login.request()) } }),
  );
  const fin = finishLogin(login, handle, start);
  const verified = await api.POST('/v1/auth/password/verify/finish', {
    body: { loginId: start.loginId!, handle, credentialFinalization: toB64(fin.message) },
  });
  if (!verified.response.ok) throw new ApiError(verified.response.status, 'unauthorized');
  const stored = ok(await api.GET('/v1/backups/{kind}', { params: { path: { kind: 'password' } } }));
  const backup = Core.openPasswordBackup(fin.exportKey, uid, fromB64(stored.ciphertext));

  const reg = new Core.OpaqueClientRegistration(utf8(next));
  const ps = ok(await api.POST('/v1/auth/password/start', { body: { handle, registrationRequest: toB64(reg.request()) } }));
  const done = reg.finish(handle, fromB64(ps.registrationResponse!));
  const tokens = ok(
    await api.POST('/v1/auth/password/finish', {
      body: { registrationUpload: toB64(done.message), passwordBackup: toB64(Core.sealPasswordBackup(done.exportKey, uid, backup)) },
    }),
  ) as Tokens;
  setAccessToken(tokens.accessToken);
  await updateRefreshToken(tokens.refreshToken);
}

// ---------------- recover with Face ID or the recovery phrase ----------------

type RecoveryProof = {
  /** Signs the server's challenge with the method's key. */
  sign: (uid: ArrayBuffer, challengeId: ArrayBuffer, nonce: ArrayBuffer, expiresAt: bigint) => ArrayBuffer;
  /** Opens the method's recovery copy. */
  open: (uid: ArrayBuffer, ciphertext: ArrayBuffer) => Core.KeyBackup;
};

/** Forgot the password: prove a recovery method, open its copy of the keys, and set a new password. */
async function recoverWith(rawHandle: string, proof: RecoveryProof, newPassword: string): Promise<StoredAccount> {
  const handle = Core.normalizeHandle(rawHandle);
  const start = ok(await api.POST('/v1/auth/recovery/start', { body: { handle } }));
  const uid = uuidToBytes(start.userId!);
  const signature = proof.sign(uid, uuidToBytes(start.challengeId!), fromB64(start.nonce!), BigInt(start.expiresAt!));
  const recovered = ok(
    await api.POST('/v1/auth/recovery/finish', { body: { challengeId: start.challengeId!, signature: toB64(signature) } }),
  );
  const auth = withToken(recovered.accessToken!);
  const stored = ok(await api.GET('/v1/recovery-methods/{id}/backup', { params: { path: { id: recovered.methodId! } }, ...auth }));
  const backup = proof.open(uid, fromB64(stored.ciphertext));

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

/** With the 12- or 24-word phrase (checked locally first: a typo or bad checksum never reaches the server). */
export async function recover(rawHandle: string, phrase: string, newPassword: string): Promise<StoredAccount> {
  const root = Core.recoveryEntropyFromPhrase(phrase);
  return recoverWith(
    rawHandle,
    {
      sign: (uid, c, n, e) => Core.signRecoveryLogin(root, uid, c, n, e),
      open: (uid, ct) => Core.openRecoveryBackup(root, uid, ct),
    },
    newPassword,
  );
}

/** With the passkey's PRF output (from Face ID / fingerprint). */
export async function recoverWithPasskey(rawHandle: string, prf: ArrayBuffer, newPassword: string): Promise<StoredAccount> {
  return recoverWith(
    rawHandle,
    {
      sign: (uid, c, n, e) => Core.signPasskeyRecoveryLogin(prf, uid, c, n, e),
      open: (uid, ct) => Core.openPasskeyBackup(prf, uid, ct),
    },
    newPassword,
  );
}

// ---------------- managing recovery methods (Settings → Account recovery) ----------------

export type RecoveryMethodInfo = { id: string; kind: 'phrase' | 'passkey'; createdAt: string; lastUsedAt?: string | null };

export async function listRecoveryMethods(): Promise<RecoveryMethodInfo[]> {
  const res = ok(await api.GET('/v1/recovery-methods'));
  return (res.methods ?? []) as RecoveryMethodInfo[];
}

/** The keys a recovery copy holds, rebuilt from this phone's keystore (no password needed). */
function backupOf(account: StoredAccount): Core.KeyBackup {
  return {
    x25519Sk: fromB64(account.x25519Sk),
    ed25519Sk: fromB64(account.ed25519Sk),
    dataKey: fromB64(account.dataKey),
    localRoot: fromB64(account.localRoot),
    epochs: [],
  };
}

/** Turns on Face ID recovery (or adds this phone's wrap of the passkey). */
export async function addPasskeyMethod(account: StoredAccount, prf: ArrayBuffer): Promise<void> {
  ok(await api.POST('/v1/recovery-methods', { body: passkeyMethod(prf, uuidToBytes(account.userId), backupOf(account)) }));
}

/** Creates a new 12-word phrase method and returns its words to show once. */
export async function addPhraseMethod(account: StoredAccount): Promise<string[]> {
  const phrase = Core.newRecoveryPhrase();
  ok(await api.POST('/v1/recovery-methods', { body: phraseMethod(phrase.entropy, uuidToBytes(account.userId), backupOf(account)) }));
  return phrase.phrase.split(' ');
}

/**
 * Checks Face ID recovery on this phone: if the passkey's PRF output here opens none of the account's passkey copies
 * (synced passkeys have been reported to differ between devices), adds a copy for it. Returns whether one was added.
 */
export async function ensurePasskeyWorksHere(account: StoredAccount, prf: ArrayBuffer): Promise<boolean> {
  const uid = uuidToBytes(account.userId);
  for (const m of (await listRecoveryMethods()).filter((x) => x.kind === 'passkey')) {
    const copy = ok(await api.GET('/v1/recovery-methods/{id}/backup', { params: { path: { id: m.id } } }));
    try {
      Core.openPasskeyBackup(prf, uid, fromB64(copy.ciphertext));
      return false;
    } catch {
      // not this one
    }
  }
  await addPasskeyMethod(account, prf);
  return true;
}

/** Removes a method after proving the current password (the server keeps at least one). */
export async function removeRecoveryMethods(account: StoredAccount, ids: string[], password: string): Promise<void> {
  const handle = Core.normalizeHandle(account.handle);
  for (const id of ids) {
    const login = new Core.OpaqueClientLogin(utf8(password));
    const start = ok(await api.POST('/v1/auth/password/verify/start', { body: { handle, credentialRequest: toB64(login.request()) } }));
    const fin = finishLogin(login, handle, start);
    const verified = ok(
      await api.POST('/v1/auth/password/verify/finish', { body: { loginId: start.loginId!, handle, credentialFinalization: toB64(fin.message) } }),
    );
    ok(await api.DELETE('/v1/recovery-methods/{id}', { params: { path: { id }, header: { 'X-Circlo-Reauth': verified.reauthToken! } } }));
  }
}

// ---------------- shared ----------------

/** Rebuilds the identity locally, checks it against the published keys, and registers this device. */
export async function finishOnThisDevice(handle: string, tokens: Tokens, backup: Core.KeyBackup): Promise<StoredAccount> {
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
