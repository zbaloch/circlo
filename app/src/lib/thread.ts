/**
 * Replies and likes (PLAN.md Phase 8), on posts and on replies. Anyone who can see a post can see and add its replies
 * and likes, and nobody else: the server checks it. A person's replies are listed only on posts I can see.
 */
import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

import type { StoredAccount } from './keystore';
import { fromRow, type FeedPost } from './posts';

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
  likeCount: number;
  likedByMe: boolean;
};

/** One of someone's replies with the post it answers (their profile's Replies tab). */
export type UserReply = { reply: Reply; post: FeedPost };

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
    likeCount: r.likeCount,
    likedByMe: r.likedByMe,
  };
}

/** A person's replies on posts I can see, newest first. `before` pages back. */
export async function fetchUserReplies(account: StoredAccount, userId: string, before?: string): Promise<UserReply[]> {
  const rows = ok(await api.GET('/v1/users/{userId}/replies', { params: { path: { userId }, query: { before, limit: 30 } } }));
  return rows.map((r) => ({ reply: fromReplyRow(r.reply, account.userId), post: fromRow(r.post, account.userId) }));
}

export async function setReplyLiked(post: Pick<FeedPost, 'postId'>, replyId: string, liked: boolean): Promise<void> {
  const params = { params: { path: { postId: post.postId, replyId } } };
  ok(liked ? await api.PUT('/v1/posts/{postId}/replies/{replyId}/like', params) : await api.DELETE('/v1/posts/{postId}/replies/{replyId}/like', params));
}

/** Optimistic like toggle on a reply (pure). */
export function toggledReplyLike(reply: Reply): Reply {
  return { ...reply, likedByMe: !reply.likedByMe, likeCount: Math.max(0, reply.likeCount + (reply.likedByMe ? -1 : 1)) };
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
