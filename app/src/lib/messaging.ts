/**
 * Messaging over MLS (PLAN.md Phase 9, CRYPTO.md 13a). Each device is its own MLS member; the core does all the
 * cryptography. This module keeps the device's MLS state (sealed by the core with the per-device local cache key),
 * the local chat history (sealed the same way: forward secrecy means old messages can't be decrypted again), key
 * packages topped up, and syncs welcomes and group logs from the delivery service.
 */
import * as Core from '@halqo/core';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { api, ok } from '@/api/client';

import { loadAddressBook } from './addressbook';
import { fromB64, toB64, utf8, uuidFromRandom, uuidToBytes, bytesToUuid } from './bytes';
import { verifyIdentitySignature, type Identity } from './friends';
import { localCacheKey, type StoredAccount } from './keystore';
import { kindName, type UploadedMedia } from './media';

const SIGNER_SLOT = 'halqo.mls-signer.v1';
const KEYCHAIN = { keychainService: 'com.halqo.app.keys', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const KEY_PACKAGE_TARGET = 20;
const KEY_PACKAGE_LOW = 5;
const MAX_HISTORY = 1000;
const HISTORY_ID = utf8('halqo-chat-index').slice(0, 16);

export type ChatMessage = {
  seq: number;
  senderUser: string;
  senderDevice: string;
  text: string;
  media: UploadedMedia[];
  createdAtMs: number;
  mine: boolean;
};

export type Conversation = {
  groupId: string;
  /** Other members' user ids (me excluded), from the MLS tree. */
  members: string[];
  /** Last log position processed. */
  cursor: number;
  /** Last position I've seen in the chat (read state stays on this device). */
  readSeq: number;
  active: boolean;
  /** A member's credential didn't verify against the identity key I hold for them: sending is blocked. */
  unverified: boolean;
  messages: ChatMessage[];
  updatedAtMs: number;
};

type History = { v: 1; conversations: Record<string, Conversation>; sentSeqs: Record<string, number[]>; keyPackagesUploaded: boolean };

// ---------------- local, sealed storage ----------------

/** Per-device folder: state and history belong to one device id (a re-login is a new device). */
function dir(): Directory {
  const d = new Directory(Paths.document, 'messaging', deviceId || 'none');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

let history: History | null = null;
let client: Core.MlsClientLike | null = null;
let deviceId = '';
const listeners = new Set<() => void>();
let snapshot: Conversation[] = [];

function notify() {
  snapshot = Object.values(history?.conversations ?? {}).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  listeners.forEach((l) => l());
}

async function loadHistory(): Promise<History> {
  if (history) return history;
  const f = new File(dir(), 'history.sealed');
  if (f.exists) {
    try {
      const plain = Core.openLocal(await localCacheKey(), HISTORY_ID, (await f.bytes()).slice().buffer);
      history = JSON.parse(new TextDecoder().decode(plain)) as History;
    } catch {
      history = null; // unreadable (different device key): start over
    }
  }
  history ??= { v: 1, conversations: {}, sentSeqs: {}, keyPackagesUploaded: false };
  notify();
  return history;
}

async function saveAll() {
  const key = await localCacheKey();
  if (client) await new File(dir(), 'state.sealed').write(new Uint8Array(client.exportState(key)));
  if (history) {
    const json = JSON.stringify(history, (_k, v) => (typeof v === 'bigint' ? Number(v) : v instanceof ArrayBuffer ? toB64(v) : v));
    await new File(dir(), 'history.sealed').write(new Uint8Array(Core.sealLocal(key, HISTORY_ID, utf8(json))));
  }
  notify();
}

// ---------------- device setup ----------------

type Signer = { sk: string; pk: string; binding: string; deviceId: string };

async function signer(account: StoredAccount): Promise<Signer> {
  const raw = await SecureStore.getItemAsync(SIGNER_SLOT, KEYCHAIN);
  const stored = raw ? (JSON.parse(raw) as Signer) : null;
  if (stored && stored.deviceId === account.deviceId) return stored;
  const pair = Core.mlsGenerateSigner();
  const identity: Core.IdentityKeys = {
    x25519Sk: fromB64(account.x25519Sk),
    x25519Pk: fromB64(account.x25519Pk),
    ed25519Sk: fromB64(account.ed25519Sk),
    ed25519Pk: fromB64(account.ed25519Pk),
  };
  const binding = Core.mlsBindCredential(identity, uuidToBytes(account.userId), uuidToBytes(account.deviceId), pair.publicKey);
  const s: Signer = { sk: toB64(pair.secretKey), pk: toB64(pair.publicKey), binding: toB64(binding), deviceId: account.deviceId };
  await SecureStore.setItemAsync(SIGNER_SLOT, JSON.stringify(s), KEYCHAIN);
  return s;
}

const dev = () => ({ header: { 'X-Halqo-Device': deviceId } });

/** Creates (or restores) this device's MLS client and keeps its key packages topped up. */
export async function ensureMessaging(account: StoredAccount): Promise<Core.MlsClientLike> {
  if (client && deviceId === account.deviceId) return client;
  deviceId = account.deviceId;
  const s = await signer(account);
  const key = await localCacheKey();
  history = null;
  const stateFile = new File(dir(), 'state.sealed');
  const state = stateFile.exists ? (await stateFile.bytes()).slice().buffer : undefined;
  const make = (st?: ArrayBuffer) =>
    new Core.MlsClient(uuidToBytes(account.userId), uuidToBytes(account.deviceId), fromB64(s.sk), fromB64(s.pk), fromB64(s.binding), key, st);
  try {
    client = make(state);
  } catch {
    // Sealed under a device key this install no longer has (e.g. app data partly lost): start this device fresh.
    stateFile.delete();
    const hist = new File(dir(), 'history.sealed');
    if (hist.exists) hist.delete();
    client = make();
  }
  const h = await loadHistory();
  const status = ok(await api.PUT('/v1/mls/key-packages', { params: dev(), body: { keyPackages: [] } }));
  const available = status.available ?? 0;
  if (!h.keyPackagesUploaded || available < KEY_PACKAGE_LOW) {
    const kps = client.keyPackages(KEY_PACKAGE_TARGET - available, !h.keyPackagesUploaded);
    const lastResort = !h.keyPackagesUploaded ? kps.pop() : undefined;
    ok(await api.PUT('/v1/mls/key-packages', { params: dev(), body: { keyPackages: kps.map(toB64), lastResort: lastResort ? toB64(lastResort) : undefined } }));
    h.keyPackagesUploaded = true;
  }
  await saveAll();
  return client;
}

export function resetMessaging() {
  client = null;
  history = null;
  deviceId = '';
  notify();
}

// ---------------- members and verification ----------------

const strangerKeys = new Map<string, string>();

/** Every member's credential binding must verify under the identity key I hold (pinned for friends). */
async function verifyMembers(account: StoredAccount, members: Core.MlsMember[]): Promise<boolean> {
  const book = await loadAddressBook(account);
  for (const m of members) {
    const userId = bytesToUuid(m.userId);
    let key = userId === account.userId ? account.ed25519Pk : book.contacts[userId]?.ed25519;
    if (!key) {
      if (!strangerKeys.has(userId)) {
        const res = await api.GET('/v1/users/{userId}/identity', { params: { path: { userId } } });
        if (!res.response.ok) return false;
        try {
          verifyIdentitySignature(userId, res.data as Identity);
        } catch {
          return false;
        }
        strangerKeys.set(userId, (res.data as Identity).ed25519Pub);
      }
      key = strangerKeys.get(userId)!;
    }
    try {
      Core.mlsVerifyMember(fromB64(key), m);
    } catch {
      return false;
    }
  }
  return true;
}

async function refreshMembers(account: StoredAccount, c: Conversation) {
  const members = client!.members(uuidToBytes(c.groupId));
  c.members = [...new Set(members.map((m) => bytesToUuid(m.userId)).filter((u) => u !== account.userId))];
  c.unverified = !(await verifyMembers(account, members));
}

// ---------------- commits ----------------

async function postToGroup(groupId: string, message: ArrayBuffer, extra: { addDevices?: string[]; removeDevices?: string[]; welcome?: ArrayBuffer } = {}) {
  return api.POST('/v1/mls/groups/{groupId}/messages', {
    params: { ...dev(), path: { groupId } },
    body: { message: toB64(message), addDevices: extra.addDevices, removeDevices: extra.removeDevices, welcome: extra.welcome ? toB64(extra.welcome) : undefined },
  });
}

function rememberSent(h: History, groupId: string, seq: number) {
  h.sentSeqs[groupId] = [...(h.sentSeqs[groupId] ?? []).slice(-200), seq];
}

/** Runs a commit; if another member committed first (409), syncs and retries once. */
async function commit(account: StoredAccount, groupId: string, build: () => { out: Core.MlsCommit; add?: string[]; remove?: string[] }) {
  const h = await loadHistory();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { out, add, remove } = build();
    const res = await postToGroup(groupId, out.commit, { addDevices: add, removeDevices: remove, welcome: out.welcome ?? undefined });
    if (res.response.status === 409 && attempt === 0) {
      client!.clearPendingCommit(uuidToBytes(groupId));
      await syncGroup(account, groupId);
      continue;
    }
    if (!res.response.ok) {
      client!.clearPendingCommit(uuidToBytes(groupId));
      ok(res);
    }
    client!.mergePendingCommit(uuidToBytes(groupId));
    rememberSent(h, groupId, Number(res.data!.seq));
    return;
  }
}

type Claimed = { userId: string; deviceId: string; keyPackage: string };

async function claim(userIds: string[]): Promise<Claimed[]> {
  const res = ok(await api.POST('/v1/mls/key-packages/claim', { params: dev(), body: { userIds } }));
  return (res.keyPackages ?? []).flatMap((k) => (k.userId && k.deviceId && k.keyPackage ? [{ userId: k.userId, deviceId: k.deviceId, keyPackage: k.keyPackage }] : []));
}

/** Starts a chat with friends (all their devices, plus my other devices). Returns the group id. */
export async function startChat(account: StoredAccount, userIds: string[]): Promise<string> {
  const c = await ensureMessaging(account);
  const groupId = uuidFromRandom(Core.newSymmetricKey());
  ok(await api.POST('/v1/mls/groups', { params: dev(), body: { groupId } }));
  c.createGroup(uuidToBytes(groupId));
  const kps = (await claim([...userIds, account.userId])).filter((k) => k.deviceId !== account.deviceId);
  if (!kps.some((k) => k.userId !== account.userId)) throw new Error('Your friend hasn’t set up messaging yet. Ask them to open Halqo.');
  await commit(account, groupId, () => ({ out: c.addMembers(uuidToBytes(groupId), kps.map((k) => fromB64(k.keyPackage))), add: kps.map((k) => k.deviceId) }));
  const h = await loadHistory();
  const conv: Conversation = { groupId, members: [], cursor: 0, readSeq: 0, active: true, unverified: false, messages: [], updatedAtMs: Date.now() };
  await refreshMembers(account, conv);
  h.conversations[groupId] = conv;
  await saveAll();
  return groupId;
}

export async function addPeople(account: StoredAccount, groupId: string, userIds: string[]) {
  const c = await ensureMessaging(account);
  const kps = await claim(userIds);
  if (kps.length === 0) throw new Error('They haven’t set up messaging yet.');
  await commit(account, groupId, () => ({ out: c.addMembers(uuidToBytes(groupId), kps.map((k) => fromB64(k.keyPackage))), add: kps.map((k) => k.deviceId) }));
  const conv = (await loadHistory()).conversations[groupId];
  if (conv) await refreshMembers(account, conv);
  await saveAll();
}

/** Removes every device of a person; they can't read anything sent afterwards. */
export async function removePerson(account: StoredAccount, groupId: string, userId: string) {
  const c = await ensureMessaging(account);
  await commit(account, groupId, () => {
    const devices = c.members(uuidToBytes(groupId)).filter((m) => bytesToUuid(m.userId) === userId).map((m) => m.deviceId);
    return { out: c.removeDevices(uuidToBytes(groupId), devices), remove: devices.map(bytesToUuid) };
  });
  const conv = (await loadHistory()).conversations[groupId];
  if (conv) await refreshMembers(account, conv);
  await saveAll();
}

// ---------------- sending and syncing ----------------

export async function sendMessage(account: StoredAccount, groupId: string, text: string, media: UploadedMedia[] = []): Promise<void> {
  const c = await ensureMessaging(account);
  const h = await loadHistory();
  const conv = h.conversations[groupId];
  if (!conv?.active) throw new Error('You’re no longer in this chat.');
  if (conv.unverified) throw new Error('Someone’s security keys in this chat changed. Verify them before sending.');
  const createdAtMs = Date.now();
  if (media.length) {
    // Members-only downloads: attach the uploaded ciphertext to this chat before sending its keys.
    ok(await api.POST('/v1/mls/groups/{groupId}/media', { params: { ...dev(), path: { groupId } }, body: { objectKeys: media.map((m) => m.objectKey) } }));
  }
  const payload = Core.encodeChatPayload({
    text,
    createdAtMs: BigInt(createdAtMs),
    media: media.map((m) => m.item),
    objectKeys: media.map((m) => m.objectKey),
  });
  const res = ok(await postToGroup(groupId, c.encrypt(uuidToBytes(groupId), payload)));
  const seq = Number(res.seq);
  rememberSent(h, groupId, seq);
  conv.messages = [...conv.messages, { seq, senderUser: account.userId, senderDevice: account.deviceId, text, media, createdAtMs, mine: true }].slice(-MAX_HISTORY);
  conv.updatedAtMs = createdAtMs;
  conv.readSeq = Math.max(conv.readSeq, seq);
  await saveAll();
}

async function syncGroup(account: StoredAccount, groupId: string) {
  const h = await loadHistory();
  const conv = h.conversations[groupId];
  if (!conv) return;
  const sent = new Set(h.sentSeqs[groupId] ?? []);
  for (;;) {
    const page = await api.GET('/v1/mls/groups/{groupId}/messages', { params: { ...dev(), path: { groupId }, query: { after: conv.cursor, limit: 200 } } });
    if (page.response.status === 404) {
      conv.active = false; // removed from the group
      break;
    }
    const rows = ok(page);
    for (const row of rows) {
      const seq = Number(row.seq);
      conv.cursor = seq;
      if (sent.has(seq) || !row.message) continue; // my own messages and commits are already applied
      let received: Core.MlsReceived;
      try {
        received = client!.process(fromB64(row.message));
      } catch {
        continue; // undecryptable (e.g. from before I joined)
      }
      if (received.tag === Core.MlsReceived_Tags.Application) {
        const { sender, plaintext } = received.inner;
        try {
          const content = Core.decodeChatPayload(plaintext);
          conv.messages.push({
            seq,
            senderUser: bytesToUuid(sender.userId),
            senderDevice: bytesToUuid(sender.deviceId),
            text: content.text,
            media: content.media.map((item, i) => ({ objectKey: content.objectKeys[i], kind: kindName(item.kind), item })),
            createdAtMs: Number(content.createdAtMs),
            mine: bytesToUuid(sender.userId) === account.userId,
          });
          conv.updatedAtMs = Math.max(conv.updatedAtMs, Number(content.createdAtMs));
        } catch {
          // malformed payload: skip
        }
      } else if (received.tag === Core.MlsReceived_Tags.Commit) {
        if (received.inner.removedSelf) conv.active = false;
        else await refreshMembers(account, conv);
      }
    }
    if (rows.length < 200) break;
  }
  conv.messages = conv.messages.slice(-MAX_HISTORY);
}

/** Joins new chats from welcomes, then reads new messages in every chat. */
export async function syncMessaging(account: StoredAccount): Promise<void> {
  const c = await ensureMessaging(account);
  const h = await loadHistory();
  for (const w of ok(await api.GET('/v1/mls/welcomes', { params: dev() }))) {
    if (!w.welcomeId || !w.welcome || !w.groupId) continue;
    try {
      const groupId = bytesToUuid(c.join(fromB64(w.welcome)));
      const conv: Conversation = { groupId, members: [], cursor: Number(w.afterSeq ?? 0), readSeq: 0, active: true, unverified: false, messages: [], updatedAtMs: Date.now() };
      await refreshMembers(account, conv);
      h.conversations[groupId] = conv;
    } catch {
      // a welcome I can't use (stale key package): drop it
    }
    await api.DELETE('/v1/mls/welcomes/{welcomeId}', { params: { ...dev(), path: { welcomeId: w.welcomeId } } });
  }
  const groups = ok(await api.GET('/v1/mls/groups', { params: dev() }));
  const live = new Set(groups.map((g) => g.groupId));
  for (const g of groups) {
    const conv = g.groupId ? h.conversations[g.groupId] : undefined;
    if (conv && Number(g.lastSeq ?? 0) > conv.cursor) await syncGroup(account, conv.groupId);
  }
  for (const conv of Object.values(h.conversations)) if (!live.has(conv.groupId)) conv.active = false;
  await saveAll();
  for (const conv of Object.values(h.conversations)) {
    if (conv.active) await addMissingDevices(account, conv.groupId).catch(() => {});
  }
}

const lastDeviceCheck = new Map<string, number>();

/**
 * A member logged in on a new phone: add that device to the chat so it receives new messages (any member may do it;
 * the server orders the commits). Checked at most every 5 minutes per chat.
 */
async function addMissingDevices(account: StoredAccount, groupId: string) {
  const now = Date.now();
  if (now - (lastDeviceCheck.get(groupId) ?? 0) < 5 * 60_000) return;
  lastDeviceCheck.set(groupId, now);
  const missing = ok(await api.GET('/v1/mls/groups/{groupId}/missing-devices', { params: { ...dev(), path: { groupId } } }));
  const deviceIds = missing.flatMap((m) => (m.deviceId ? [m.deviceId] : []));
  if (deviceIds.length === 0) return;
  const res = ok(await api.POST('/v1/mls/key-packages/claim', { params: dev(), body: { userIds: [], deviceIds } }));
  const kps = (res.keyPackages ?? []).flatMap((k) => (k.deviceId && k.keyPackage ? [{ deviceId: k.deviceId, keyPackage: k.keyPackage }] : []));
  if (kps.length === 0) return;
  await commit(account, groupId, () => ({ out: client!.addMembers(uuidToBytes(groupId), kps.map((k) => fromB64(k.keyPackage))), add: kps.map((k) => k.deviceId) }));
  const conv = (await loadHistory()).conversations[groupId];
  if (conv) await refreshMembers(account, conv);
  await saveAll();
}

export async function markRead(groupId: string) {
  const h = await loadHistory();
  const conv = h.conversations[groupId];
  if (!conv) return;
  const last = conv.messages[conv.messages.length - 1]?.seq ?? conv.cursor;
  if (last > conv.readSeq) {
    conv.readSeq = last;
    await saveAll();
  }
}

/** Pure: unread count for a conversation (messages from others after my read position). */
export function unreadCount(c: Pick<Conversation, 'messages' | 'readSeq'>): number {
  return c.messages.filter((m) => !m.mine && m.seq > c.readSeq).length;
}

export function useConversations(): Conversation[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => snapshot,
  );
}

/** Removes local chat history and MLS state (sign-out). The device's MLS key stays tied to this device id. */
export async function clearMessaging() {
  resetMessaging();
  const d = new Directory(Paths.document, 'messaging');
  if (d.exists) d.delete();
  await SecureStore.deleteItemAsync(SIGNER_SLOT, KEYCHAIN);
}
