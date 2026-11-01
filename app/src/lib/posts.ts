/**
 * Posts (PLAN.md Phase 7): text up to 500 characters and up to 4 photos or 1 video, for Only me, Everyone, or one or
 * more of my circles. The server decides who may see each post and returns its audience only to me, its author.
 */
import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

import { loadAddressBook, type AddressBook, type Audience } from './addressbook';
import { apiAudience, fromApiAudience, validAudience } from './circles';
import type { StoredAccount } from './keystore';
import { discardPicked, discardPrepared, prepare, upload, type Attachment, type PickedMedia, type PreparedItem } from './media';

export const MAX_POST_CHARS = 500;

export type Draft = { text: string; audience: Audience; media: PickedMedia[] };

export type FeedPost = {
  postId: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatar?: string | null;
  createdAtMs: number;
  text: string;
  media: Attachment[];
  mine: boolean;
  /** Author-only: who my own post went to. Never set for other people's posts. */
  audience?: Audience;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
};

type PostRow = components['schemas']['Post'];

/** The app's form of a post from the server (pure; exported for tests). */
export function fromRow(row: PostRow, myId: string): FeedPost {
  const mine = row.authorId === myId;
  return {
    postId: row.postId,
    authorId: row.authorId,
    authorName: row.author.name,
    authorHandle: row.author.username,
    authorAvatar: row.author.avatarUrl,
    createdAtMs: Date.parse(row.createdAt),
    text: row.text,
    media: row.media,
    mine,
    audience: mine ? fromApiAudience(row.audience) : undefined,
    replyCount: row.replyCount,
    likeCount: row.likeCount,
    likedByMe: row.likedByMe,
  };
}

/** Pure validation shared by the composer and publish. Returns an error message or null. */
export function validateDraft(d: Draft, book: Pick<AddressBook, 'circleDefs'>): string | null {
  const chars = [...d.text.trim()].length;
  const images = d.media.filter((m) => m.type === 'image').length;
  const videos = d.media.filter((m) => m.type === 'video').length;
  if (chars === 0 && d.media.length === 0) return 'Write something or add a photo or video.';
  if (chars > MAX_POST_CHARS) return `Posts can be up to ${MAX_POST_CHARS} characters.`;
  if (videos > 1 || (videos === 1 && images > 0)) return 'Add up to 4 photos or 1 video.';
  if (images > 4) return 'Add up to 4 photos or 1 video.';
  if (!validAudience(book, d.audience)) return 'Choose who can see this.';
  return null;
}

/** Prepares and uploads media (metadata removed), then creates the post. Returns the new post. */
export async function publishPost(account: StoredAccount, draft: Draft, onProgress?: (fraction: number) => void): Promise<FeedPost> {
  const problem = validateDraft(draft, await loadAddressBook(account));
  if (problem) throw new Error(problem);
  const prepared: PreparedItem[] = [];
  try {
    for (const m of draft.media) prepared.push(await prepare(m));
    const media = await upload(prepared, (f) => onProgress?.(f * 0.95));
    const row = ok(await api.POST('/v1/posts', { body: { text: draft.text.trim(), audience: apiAudience(draft.audience), media } }));
    onProgress?.(1);
    discardPicked(draft.media); // kept until success so a failed upload can be retried
    return fromRow(row, account.userId);
  } finally {
    discardPrepared(prepared);
  }
}

export async function deletePost(postId: string): Promise<void> {
  ok(await api.DELETE('/v1/posts/{postId}', { params: { path: { postId } } }));
}

export type Page = { posts: FeedPost[]; cursor?: string; hasMore: boolean };

function page(rows: PostRow[], myId: string, limit: number): Page {
  return { posts: rows.map((r) => fromRow(r, myId)), cursor: rows.length ? rows[rows.length - 1].createdAt : undefined, hasMore: rows.length === limit };
}

/** One page of the timeline (me + friends), newest first. */
export async function fetchFeedPage(account: StoredAccount, before?: string, limit = 30): Promise<Page> {
  return page(ok(await api.GET('/v1/feed', { params: { query: { before, limit } } })), account.userId, limit);
}

/** One page of a single person's posts that I may see. */
export async function fetchAuthorPosts(account: StoredAccount, authorId: string, opts: { before?: string; limit?: number } = {}): Promise<Page> {
  const limit = opts.limit ?? 30;
  const rows = ok(await api.GET('/v1/users/{userId}/posts', { params: { path: { userId: authorId }, query: { before: opts.before, limit } } }));
  return page(rows, account.userId, limit);
}

export async function fetchPost(account: StoredAccount, postId: string): Promise<FeedPost> {
  return fromRow(ok(await api.GET('/v1/posts/{postId}', { params: { path: { postId } } })), account.userId);
}

/** "See what they can see": my posts exactly as `friendId` sees them (no audience badges). */
export async function previewAs(account: StoredAccount, friendId: string, before?: string, limit = 30): Promise<Page> {
  const rows = ok(await api.GET('/v1/me/preview/{friendId}', { params: { path: { friendId }, query: { before, limit } } }));
  const p = page(rows, account.userId, limit);
  return { ...p, posts: p.posts.map((x) => ({ ...x, mine: false, audience: undefined })) };
}
