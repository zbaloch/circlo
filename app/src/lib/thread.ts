/**
 * Replies and likes (PLAN.md Phase 8). Anyone who can see a post can see and add its replies and likes, and nobody
 * else: the server checks it.
 */
import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

import type { StoredAccount } from './keystore';
import type { FeedPost } from './posts';

export const MAX_REPLY_CHARS = 500;

export type Reply = {
  replyId: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string | null;
  text: string;
  createdAtMs: number;
  mine: boolean;
};

export type Liker = { userId: string; name: string; handle: string };

/** The app's form of a reply (pure; exported for tests). */
export function fromReplyRow(r: components['schemas']['Reply'], myId: string): Reply {
  return {
    replyId: r.replyId,
    authorId: r.authorId,
    authorName: r.author.name,
    authorHandle: r.author.username,
    authorAvatar: r.author.avatarUrl,
    text: r.text,
    createdAtMs: Date.parse(r.createdAt),
    mine: r.authorId === myId,
  };
}

/** Replies, oldest first. */
export async function fetchReplies(account: StoredAccount, post: Pick<FeedPost, 'postId'>): Promise<Reply[]> {
  const rows = ok(await api.GET('/v1/posts/{postId}/replies', { params: { path: { postId: post.postId } } }));
  return rows.map((r) => fromReplyRow(r, account.userId));
}

export function validateReply(text: string): string | null {
  const n = [...text.trim()].length;
  if (n === 0) return 'Write a reply.';
  if (n > MAX_REPLY_CHARS) return `Replies can be up to ${MAX_REPLY_CHARS} characters.`;
  return null;
}

export async function sendReply(account: StoredAccount, post: Pick<FeedPost, 'postId'>, text: string): Promise<Reply> {
  const problem = validateReply(text);
  if (problem) throw new Error(problem);
  const row = ok(await api.POST('/v1/posts/{postId}/replies', { params: { path: { postId: post.postId } }, body: { text: text.trim() } }));
  return fromReplyRow(row, account.userId);
}

export async function deleteReply(post: Pick<FeedPost, 'postId'>, replyId: string): Promise<void> {
  ok(await api.DELETE('/v1/posts/{postId}/replies/{replyId}', { params: { path: { postId: post.postId, replyId } } }));
}

export async function setLiked(post: Pick<FeedPost, 'postId'>, liked: boolean): Promise<void> {
  const params = { params: { path: { postId: post.postId } } };
  ok(liked ? await api.PUT('/v1/posts/{postId}/like', params) : await api.DELETE('/v1/posts/{postId}/like', params));
}

export async function fetchLikers(post: Pick<FeedPost, 'postId'>): Promise<Liker[]> {
  const rows = ok(await api.GET('/v1/posts/{postId}/likes', { params: { path: { postId: post.postId } } }));
  return rows.map((p) => ({ userId: p.userId, name: p.name, handle: p.username }));
}

/** Optimistic like toggle on a post object (pure). */
export function toggledLike(post: FeedPost): FeedPost {
  return { ...post, likedByMe: !post.likedByMe, likeCount: Math.max(0, post.likeCount + (post.likedByMe ? -1 : 1)) };
}
