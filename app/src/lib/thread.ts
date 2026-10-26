/**
 * Replies and likes (PLAN.md Phase 8, CRYPTO.md section 9). A reply is sealed by the core under a key derived from
 * the post key and signed by the replier, so exactly the people who can read the post can read its replies.
 * Likes are plain rows; the app only shows them on posts it could decrypt.
 */
import * as Core from '@halqo/core';

import { api, ok } from '@/api/client';

import { loadAddressBook } from './addressbook';
import { fromB64, toB64, uuidFromRandom, uuidToBytes } from './bytes';
import { verifyIdentitySignature, type Identity } from './friends';
import type { StoredAccount } from './keystore';
import type { FeedPost } from './posts';

export const MAX_REPLY_CHARS = 500;

export type Reply = {
  replyId: string;
  authorId: string;
  text: string;
  createdAtMs: number;
  mine: boolean;
  /** False when the replier isn't someone I've pinned (a friend of the author I don't know): key from the server. */
  pinned: boolean;
};

const strangerKeys = new Map<string, string>();

/** The replier's signing key: pinned for friends and me; otherwise fetched once and self-signature-checked. */
async function signingKey(account: StoredAccount, userId: string): Promise<{ key: string; pinned: boolean } | null> {
  if (userId === account.userId) return { key: account.ed25519Pk, pinned: true };
  const contact = (await loadAddressBook(account)).contacts[userId];
  if (contact) return { key: contact.ed25519, pinned: true };
  if (!strangerKeys.has(userId)) {
    const res = await api.GET('/v1/users/{userId}/identity', { params: { path: { userId } } });
    if (!res.response.ok) return null;
    const id = res.data as Identity;
    try {
      verifyIdentitySignature(userId, id);
    } catch {
      return null;
    }
    strangerKeys.set(userId, id.ed25519Pub);
  }
  return { key: strangerKeys.get(userId)!, pinned: false };
}

/** Replies I can open, oldest first. Replies that fail to open (tampered, wrong signer) are dropped. */
export async function fetchReplies(account: StoredAccount, post: FeedPost): Promise<Reply[]> {
  const rows = ok(await api.GET('/v1/posts/{postId}/replies', { params: { path: { postId: post.postId } } }));
  const out: Reply[] = [];
  for (const r of rows) {
    if (!r.replyId || !r.authorId || !r.ciphertext) continue;
    const signer = await signingKey(account, r.authorId);
    if (!signer) continue;
    try {
      const c = Core.openReply(post.postKey, fromB64(signer.key), uuidToBytes(post.postId), uuidToBytes(r.replyId), uuidToBytes(r.authorId), fromB64(r.ciphertext));
      out.push({ replyId: r.replyId, authorId: r.authorId, text: c.text, createdAtMs: Number(c.createdAtMs), mine: r.authorId === account.userId, pinned: signer.pinned });
    } catch {
      // not openable with this post's key / signer: skip
    }
  }
  return out;
}

export function validateReply(text: string): string | null {
  const n = [...text.trim()].length;
  if (n === 0) return 'Write a reply.';
  if (n > MAX_REPLY_CHARS) return `Replies can be up to ${MAX_REPLY_CHARS} characters.`;
  return null;
}

export async function sendReply(account: StoredAccount, post: FeedPost, text: string): Promise<Reply> {
  const problem = validateReply(text);
  if (problem) throw new Error(problem);
  const replyId = uuidFromRandom(Core.newSymmetricKey());
  const createdAtMs = Date.now();
  const identity: Core.IdentityKeys = {
    x25519Sk: fromB64(account.x25519Sk),
    x25519Pk: fromB64(account.x25519Pk),
    ed25519Sk: fromB64(account.ed25519Sk),
    ed25519Pk: fromB64(account.ed25519Pk),
  };
  const ct = Core.sealReply(post.postKey, identity, uuidToBytes(post.postId), uuidToBytes(replyId), uuidToBytes(account.userId), {
    text: text.trim(),
    createdAtMs: BigInt(createdAtMs),
  });
  ok(await api.POST('/v1/posts/{postId}/replies', { params: { path: { postId: post.postId } }, body: { replyId, ciphertext: toB64(ct) } }));
  return { replyId, authorId: account.userId, text: text.trim(), createdAtMs, mine: true, pinned: true };
}

export async function deleteReply(postId: string, replyId: string): Promise<void> {
  ok(await api.DELETE('/v1/posts/{postId}/replies/{replyId}', { params: { path: { postId, replyId } } }));
}

export async function setLiked(postId: string, liked: boolean): Promise<void> {
  const params = { params: { path: { postId } } };
  ok(liked ? await api.PUT('/v1/posts/{postId}/like', params) : await api.DELETE('/v1/posts/{postId}/like', params));
}

export async function fetchLikers(postId: string): Promise<string[]> {
  return ok(await api.GET('/v1/posts/{postId}/likes', { params: { path: { postId } } })).flatMap((l) => (l.userId ? [l.userId] : []));
}

/** Optimistic like toggle on a post object (pure). */
export function toggledLike(post: FeedPost): FeedPost {
  return { ...post, likedByMe: !post.likedByMe, likeCount: Math.max(0, post.likeCount + (post.likedByMe ? -1 : 1)) };
}
