/**
 * On-device crypto self-test (Phase 2 dev screen). Exercises the native Rust core end to end; contains no crypto
 * of its own. Never shipped to users: the dev screen only appears in __DEV__ builds.
 */
import * as Core from '@circlo/core';
import { File, FileMode, Paths } from 'expo-file-system';

export type CheckResult = { name: string; ok: boolean; ms: number; detail?: string };

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytes(s: string): ArrayBuffer {
  return enc.encode(s).slice().buffer;
}

function id16(): ArrayBuffer {
  return Core.newSymmetricKey().slice(0, 16);
}

function fails(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

function plainPath(file: File): string {
  return decodeURIComponent(file.uri.replace(/^file:\/\//, ''));
}

async function timed(name: string, fn: () => Promise<string | void> | string | void): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = (await fn()) ?? undefined;
    return { name, ok: true, ms: Date.now() - start, detail };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - start, detail: e instanceof Error ? e.message : String(e) };
  }
}

function check(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
}

export async function runQuickChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push(
    await timed('Sealed blob round trip + tamper rejected', () => {
      const key = Core.newSymmetricKey();
      const [user, epoch] = [id16(), id16()];
      const ct = Core.sealProfile(key, user, epoch, bytes('{"displayName":"Test"}'));
      check(dec.decode(Core.openProfile(key, user, epoch, ct)) === '{"displayName":"Test"}', 'round trip');
      const tampered = new Uint8Array(ct.slice(0));
      tampered[tampered.length - 1] ^= 1;
      check(fails(() => Core.openProfile(key, user, epoch, tampered.buffer)), 'tampered blob opened');
    }),
  );

  results.push(
    await timed('Circle 7 friend reads 7 and 9, not 5; Close Friends only for members', () => {
      const [alice, bob, carol] = [Core.generateIdentity(), Core.generateIdentity(), Core.generateIdentity()];
      const [aliceId, bobId, carolId, epoch] = [id16(), id16(), id16(), id16()];
      const root = Core.newSymmetricKey();
      const payload = Core.sealFriendPayload(alice, bob.x25519Pk, aliceId, bobId, epoch, root, 7, Core.newSymmetricKey(), true);
      const key = Core.openFriendPayload(bob, alice.x25519Pk, aliceId, bobId, epoch, payload);
      const ring = Core.ReaderKeyring.withExclusive(key.circleKey, key.exclusiveKey);
      const toCarol = Core.sealFriendPayload(alice, carol.x25519Pk, aliceId, carolId, epoch, root, 2, Core.newSymmetricKey(), false);
      const carolKey = Core.openFriendPayload(carol, alice.x25519Pk, aliceId, carolId, epoch, toCarol);
      const carolRing = Core.ReaderKeyring.withExclusive(carolKey.circleKey, carolKey.exclusiveKey);
      check(toCarol.byteLength === payload.byteLength, 'membership changed the payload size');
      const closePost = Core.sealPostCloseFriends(alice, aliceId, epoch, epoch, root, { text: 'cf', createdAtMs: BigInt(Date.now()), media: [] });
      const opens = (r: Core.ReaderKeyringLike) => !fails(() => r.openPost(alice.ed25519Pk, aliceId, epoch, epoch, closePost.keyRef, closePost.headerCt));
      check(opens(ring) && !opens(carolRing), 'Close Friends access wrong');
      const readable = (circle: number) => {
        const postId = id16();
        const content = { text: `to circle ${circle}`, createdAtMs: BigInt(Date.now()), media: [] };
        const s = Core.sealPost(alice, aliceId, postId, epoch, root, circle, content);
        return !fails(() => ring.openPost(alice.ed25519Pk, aliceId, postId, epoch, s.keyRef, s.headerCt));
      };
      check(readable(7) && readable(9) && !readable(5), 'circle access wrong');
      return `payload ${payload.byteLength} bytes`;
    }),
  );

  results.push(
    await timed('Recovery phrase round trip', () => {
      const r = Core.newRecoveryPhrase();
      check(r.phrase.split(' ').length === 24, '24 words');
      const back = new Uint8Array(Core.recoveryEntropyFromPhrase(r.phrase.toUpperCase()));
      check(back.every((b, i) => b === new Uint8Array(r.entropy)[i]), 'entropy mismatch');
    }),
  );

  results.push(
    await timed('OPAQUE register + login (Argon2id 64 MiB)', () => {
      const setup = Core.opaqueServerSetupNew();
      const handle = 'selftest_user';
      const credId = Core.newSymmetricKey();
      const reg = new Core.OpaqueClientRegistration(bytes('correct horse battery staple'));
      const regResp = Core.opaqueServerRegistrationStart(setup, credId, reg.request());
      const regFin = reg.finish(handle, regResp);
      const record = Core.opaqueServerRegistrationFinish(regFin.message);
      const login = new Core.OpaqueClientLogin(bytes('correct horse battery staple'));
      const start = Core.opaqueServerLoginStart(setup, record, credId, handle, login.request());
      const fin = login.finish(handle, start.response);
      Core.opaqueServerLoginFinish(start.state, handle, fin.message);
      check(fin.exportKey.byteLength === 64, 'export key');
      const wrong = new Core.OpaqueClientLogin(bytes('wrong password'));
      const wrongStart = Core.opaqueServerLoginStart(setup, record, credId, handle, wrong.request());
      check(fails(() => wrong.finish(handle, wrongStart.response)), 'wrong password accepted');
    }),
  );

  results.push(await streamFile(5));
  return results;
}

/** Streams a file of `megabytes` through encrypt + decrypt on disk; JS never holds more than 1 MiB. */
export async function streamFile(megabytes: number): Promise<CheckResult> {
  return timed(`Stream ${megabytes} MB file encrypt + decrypt`, async () => {
    const plain = new File(Paths.cache, 'selftest-plain.bin');
    const sealed = new File(Paths.cache, 'selftest-sealed.bin');
    const opened = new File(Paths.cache, 'selftest-opened.bin');
    try {
      plain.create({ overwrite: true });
      const block = new Uint8Array(1 << 20).map((_, i) => i % 251);
      const handle = plain.open(FileMode.WriteOnly);
      try {
        for (let i = 0; i < megabytes; i++) handle.writeBytesSync(block);
      } finally {
        handle.close();
      }
      const key = Core.newSymmetricKey();
      const objectId = id16();
      const started = Date.now();
      const len = Core.encryptFile(plainPath(plain), plainPath(sealed), key, objectId);
      Core.decryptFile(plainPath(sealed), plainPath(opened), key, objectId, len);
      check(opened.size === megabytes * (1 << 20), 'size mismatch after decrypt');
      return `crypto ${Date.now() - started} ms, ciphertext ${(sealed.size / (1 << 20)).toFixed(1)} MB (padded)`;
    } finally {
      for (const f of [plain, sealed, opened]) if (f.exists) f.delete();
    }
  });
}

/**
 * Phase 8 feed benchmark: 50 authors × 10 posts sealed at circles 5–12, opened with the keyring a friend in circle 7
 * holds (exactly what the timeline does per row, including the failed trial decryptions for posts not meant for them).
 */
export async function feedBenchmark(authors = 50, perAuthor = 10): Promise<CheckResult> {
  const sealed: { pk: ArrayBuffer; author: ArrayBuffer; post: ArrayBuffer; epoch: ArrayBuffer; keyRef: ArrayBuffer; headerCt: ArrayBuffer; ring: Core.ReaderKeyringLike }[] = [];
  for (let a = 0; a < authors; a++) {
    const id = Core.generateIdentity();
    const authorId = Core.newSymmetricKey().slice(0, 16);
    const epochId = Core.newSymmetricKey().slice(0, 16);
    const root = Core.newSymmetricKey();
    const ring = Core.ReaderKeyring.forCircle(root, 7, false);
    for (let i = 0; i < perAuthor; i++) {
      const postId = Core.newSymmetricKey().slice(0, 16);
      const s = Core.sealPost(id, authorId, postId, epochId, root, 5 + (i % 8), { text: `post ${a}/${i} `.repeat(8), createdAtMs: BigInt(Date.now()), media: [] });
      sealed.push({ pk: id.ed25519Pk, author: authorId, post: postId, epoch: epochId, keyRef: s.keyRef, headerCt: s.headerCt, ring });
    }
  }
  return timed(`Open ${authors * perAuthor} posts from ${authors} friends`, () => {
    const start = Date.now();
    let opened = 0;
    for (const s of sealed) {
      try {
        s.ring.openPost(s.pk, s.author, s.post, s.epoch, s.keyRef, s.headerCt);
        opened++;
      } catch {
        // not for circle 7
      }
    }
    const ms = Date.now() - start;
    const expected = authors * Array.from({ length: perAuthor }, (_, i) => 5 + (i % 8)).filter((c) => c >= 7).length;
    check(opened === expected, `opened ${opened}, expected ${expected}`);
    return `${opened} readable, ${sealed.length - opened} skipped, ${ms} ms total (${(ms / sealed.length).toFixed(2)} ms/post)`;
  });
}
