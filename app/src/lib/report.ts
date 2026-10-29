/**
 * Reports to the operator (PLAN.md Phase 11, CRYPTO.md 13c). The reporter chooses to share what they saw: this device
 * assembles the post, profile or message as they see it, and the core signs it and seals it to the operator's moderation key under a
 * fresh report id. The server stores ciphertext only; the operator opens it offline. The person reported isn't told.
 */
import * as Core from '@circlo/core';

import { api, ok } from '@/api/client';

import { fromB64, toB64, utf8, uuidFromRandom, uuidToBytes } from './bytes';
import type { StoredAccount } from './keystore';
import { imageUri, type UploadedMedia } from './media';
import type { ChatMessage } from './messaging';
import type { FeedPost } from './posts';

export const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'hate', label: 'Hate or threats of violence' },
  { id: 'sexual', label: 'Nudity or sexual content' },
  { id: 'child_safety', label: 'Puts a child at risk' },
  { id: 'self_harm', label: 'Self-harm or suicide' },
  { id: 'spam', label: 'Spam, scam or fake account' },
  { id: 'other', label: 'Something else' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

export type ReportedPost = {
  postId: string;
  authorId: string;
  authorName?: string;
  authorHandle?: string;
  createdAtMs: number;
  text: string;
  videos: number;
};

export type ReportedUser = { userId: string; name?: string; handle?: string; bio?: string };

export type ReportedMessage = {
  chatId: string;
  seq: number;
  senderId: string;
  senderName?: string;
  senderHandle?: string;
  createdAtMs: number;
  text: string;
  videos: number;
};

/** What is being reported, as the reporter sees it. Photos are data URIs decrypted on this device. */
export type ReportSubject =
  | { kind: 'post'; post: ReportedPost; photos: string[] }
  | { kind: 'user'; user: ReportedUser }
  | { kind: 'message'; message: ReportedMessage; photos: string[] };

const MAX_NOTE = 1000;
/** The core's limit is 4 MiB; leave room for everything else in the report. */
const PHOTO_BUDGET = 3_500_000;

/** Keeps photos while they fit the budget; says how many were left out. */
function fitPhotos(photos: string[]) {
  const kept: string[] = [];
  let used = 0;
  for (const p of photos) {
    if (used + p.length > PHOTO_BUDGET) continue;
    kept.push(p);
    used += p.length;
  }
  return { photos: kept, ...(kept.length < photos.length ? { photosLeftOut: photos.length - kept.length } : {}) };
}

function subjectBody(subject: ReportSubject) {
  switch (subject.kind) {
    case 'post': {
      const { createdAtMs, videos, ...post } = subject.post;
      return { post: { ...post, createdAt: new Date(createdAtMs).toISOString(), ...fitPhotos(subject.photos), videos } };
    }
    case 'message': {
      const { createdAtMs, videos, ...message } = subject.message;
      return { message: { ...message, createdAt: new Date(createdAtMs).toISOString(), ...fitPhotos(subject.photos), videos } };
    }
    case 'user':
      return { user: subject.user };
  }
}

/** The report as JSON bytes (pure). */
export function reportBody({ reason, note, subject }: { reason: ReportReason; note: string; subject: ReportSubject }): ArrayBuffer {
  if (!REPORT_REASONS.some((r) => r.id === reason)) throw new Error('unknown report reason');
  if (!['post', 'user', 'message'].includes(subject.kind)) throw new Error('unknown report kind');
  const clean = note.trim().slice(0, MAX_NOTE);
  return utf8(
    JSON.stringify({
      v: 1,
      kind: subject.kind,
      reason,
      ...(clean ? { note: clean } : {}),
      reportedAt: new Date().toISOString(),
      ...subjectBody(subject),
    }),
  );
}

let moderationKey: Promise<string> | null = null;

/** The operator's moderation public key, or '' if reporting isn't set up on this server. */
export function loadModerationKey(): Promise<string> {
  moderationKey ??= api.GET('/v1/config').then(
    (res) => ok(res).moderationPublicKey ?? '',
    (e) => {
      moderationKey = null; // retry next time
      throw e;
    },
  );
  return moderationKey;
}

/** Decrypted photos of a post or message, as data URIs (a photo that can't be fetched is skipped). */
async function photosOf(media: UploadedMedia[]): Promise<string[]> {
  const photos = await Promise.all(
    media.filter((m) => m.kind === 'full' && m.item.mime.startsWith('image/')).map((m) => imageUri(m).catch(() => '')),
  );
  return photos.filter(Boolean);
}

const videoCount = (media: UploadedMedia[]) => media.filter((m) => m.kind === 'full' && m.item.mime.startsWith('video/')).length;

type Person = { name?: string; handle?: string };

/** Seals a report to the operator's moderation key, signed by me under a fresh report id, and sends it. */
async function send(account: StoredAccount, reason: ReportReason, note: string, subject: ReportSubject): Promise<void> {
  const key = await loadModerationKey();
  if (!key) throw new Error('Reporting isn’t available on this server yet.');
  const body = reportBody({ reason, note, subject });
  const reportId = uuidFromRandom(Core.newSymmetricKey());
  const identity = { x25519Sk: fromB64(account.x25519Sk), x25519Pk: fromB64(account.x25519Pk), ed25519Sk: fromB64(account.ed25519Sk), ed25519Pk: fromB64(account.ed25519Pk) };
  const sealed = Core.sealReport(fromB64(key), identity, uuidToBytes(account.userId), uuidToBytes(reportId), body);
  ok(await api.POST('/v1/reports', { body: { reportId, sealed: toB64(sealed) } }));
}

/** Reports a post I can see: its text and photos, as I see them. */
export async function reportPost(account: StoredAccount, post: FeedPost, author: Person, reason: ReportReason, note: string): Promise<void> {
  const photos = await photosOf(post.media);
  await send(account, reason, note, {
    kind: 'post',
    photos,
    post: {
      postId: post.postId,
      authorId: post.authorId,
      authorName: author.name,
      authorHandle: author.handle,
      createdAtMs: post.createdAtMs,
      text: post.text,
      videos: videoCount(post.media),
    },
  });
}

/** Reports a person: their profile (name, handle, bio) as I see it. */
export async function reportUser(account: StoredAccount, user: ReportedUser, reason: ReportReason, note: string): Promise<void> {
  await send(account, reason, note, { kind: 'user', user });
}

/** Reports one chat message: its text and photos, as I see them. Other messages in the chat are not included. */
export async function reportMessage(account: StoredAccount, chatId: string, message: ChatMessage, sender: Person, reason: ReportReason, note: string): Promise<void> {
  const photos = await photosOf(message.media);
  await send(account, reason, note, {
    kind: 'message',
    photos,
    message: {
      chatId,
      seq: message.seq,
      senderId: message.senderUser,
      senderName: sender.name,
      senderHandle: sender.handle,
      createdAtMs: message.createdAtMs,
      text: message.text,
      videos: videoCount(message.media),
    },
  });
}
