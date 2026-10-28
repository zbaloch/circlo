/**
 * Posts (PLAN.md Phase 7, CRYPTO.md section 8). The header (text, media keys, mime types, sizes) is sealed by the core
 * under a per-post key derived from my circle chain; the server sees only an opaque header, a key ref that reveals
 * neither the circle nor which posts share an audience, and random object keys. The circle a post went to is kept
 * only in my encrypted address book, so only I ever see it.
 */
import * as Core from '@circlo/core';

import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

import { loadAddressBook, updateAddressBook, type AddressBook } from './addressbook';
import { fromB64, toB64, uuidFromRandom, uuidToBytes } from './bytes';
import { ensureEpoch, refreshContact } from './friends';
import type { StoredAccount } from './keystore';
import { discardPicked, discardPrepared, encryptAndUpload, matchMedia, prepare, type PickedMedia, type UploadedMedia } from './media';

export const MAX_POST_CHARS = 500;

export type Draft = { text: string; circle: number; media: PickedMedia[] };

export type FeedPost = {
  postId: string;
  authorId: string;
  createdAtMs: number;
  text: string;
  media: UploadedMedia[];
  mine: boolean;
  /** Author-only: the circle my own post went to. Never set for other people's posts. */
  circle?: number;
  epochId: string;
  /** Memory only: opens this post's replies. Never stored or sent anywhere. */
  postKey: ArrayBuffer;
  /** Memory only: proves to the server I'm in this post's audience (replies, likes, counts). Derived from postKey. */
  readToken: ArrayBuffer;
  replyCount: number;
  likeCount: number;
  likedByMe: boolean;
};

type PostRow = components['schemas']['PostView'];

function identity(a: StoredAccount): Core.IdentityKeys {
  return { x25519Sk: fromB64(a.x25519Sk), x25519Pk: fromB64(a.x25519Pk), ed25519Sk: fromB64(a.ed25519Sk), ed25519Pk: fromB64(a.ed25519Pk) };
}

/** Pure validation shared by the composer and publish. Returns an error message or null. */
export function validateDraft(d: Draft): string | null {
  const chars = [...d.text].length;
  const images = d.media.filter((m) => m.type === 'image').length;
  const videos = d.media.filter((m) => m.type === 'video').length;
  if (chars === 0 && d.media.length === 0) return 'Write something or add a photo or video.';
  if (chars > MAX_POST_CHARS) return `Posts can be up to ${MAX_POST_CHARS} characters.`;
  if (videos > 1 || (videos === 1 && images > 0)) return 'Add up to 4 photos or 1 video.';
  if (images > 4) return 'Add up to 4 photos or 1 video.';
  if (!Number.isInteger(d.circle) || d.circle < 1 || d.circle > 100) return 'Choose who can see this.';
  return null;
}

/** Prepares, encrypts and uploads media, then seals and creates the post. Returns the new post id. */
export async function publishPost(account: StoredAccount, draft: Draft, onProgress?: (fraction: number) => void): Promise<string> {
  const problem = validateDraft(draft);
  if (problem) throw new Error(problem);
  const epoch = await ensureEpoch(account);
  const prepared = [];
  try {
    for (const m of draft.media) prepared.push(...(await prepare(m)));
    const uploaded = await encryptAndUpload(prepared, (f) => onProgress?.(f * 0.95));
    const postId = uuidFromRandom(Core.newSymmetricKey());
    const sealed = Core.sealPost(identity(account), uuidToBytes(account.userId), uuidToBytes(postId), uuidToBytes(epoch.epochId), fromB64(epoch.root), draft.circle, {
      text: draft.text,
      createdAtMs: BigInt(Date.now()),
      media: uploaded.map((u) => u.item),
    });
    ok(
      await api.POST('/v1/posts', {
        body: {
          postId,
          epochId: epoch.epochId,
          keyRef: toB64(sealed.keyRef),
          headerCt: toB64(sealed.headerCt),
          media: uploaded.map((u) => ({ objectKey: u.objectKey, kind: u.kind })),
          // Only H(read_token): replies and likes then need the token, which only this post's audience can derive.
          readTokenHash: toB64(Core.postReadTokenHash(Core.postReadToken(sealed.postKey))),
        },
      }),
    );
    await updateAddressBook(account, (b) => {
      b.postCircles = { ...b.postCircles, [postId]: draft.circle };
      b.lastCircle = draft.circle;
    });
    onProgress?.(1);
    discardPicked(draft.media); // kept until success so a failed upload can be retried
    return postId;
  } finally {
    discardPrepared(prepared);
  }
}

export async function deletePost(account: StoredAccount, postId: string): Promise<void> {
  ok(await api.DELETE('/v1/posts/{postId}', { params: { path: { postId } } }));
  await updateAddressBook(account, (b) => {
    if (b.postCircles) delete b.postCircles[postId];
  });
}

type Keyring = Core.ReaderKeyringLike | null;

/** The keys I hold for an author's epoch: my own chain root, or the circle key a friend gave me. */
function keyringFor(account: StoredAccount, book: AddressBook, authorId: string, epochId: string): Keyring {
  if (authorId === account.userId) {
    const mine = book.myEpochs.find((e) => e.epochId === epochId);
    return mine ? Core.ReaderKeyring.forOwner(fromB64(mine.root)) : null;
  }
  const key = book.contacts[authorId]?.keys.find((k) => k.epochId === epochId);
  return key ? new Core.ReaderKeyring(fromB64(key.circleKey)) : null;
}

/**
 * Opens server rows with the given keyrings. Rows for circles the keyring doesn't reach (or from epochs it doesn't
 * cover) fail to open and are skipped; the server can't tell which ones opened.
 */
function openRows(account: StoredAccount, book: AddressBook, rows: PostRow[], keyring: (authorId: string, epochId: string) => Keyring): FeedPost[] {
  const cache = new Map<string, Keyring>();
  const posts: FeedPost[] = [];
  for (const row of rows) {
    if (!row.postId || !row.epochId || !row.keyRef || !row.headerCt || !row.authorId) continue;
    const mine = row.authorId === account.userId;
    const authorKey = mine ? account.ed25519Pk : book.contacts[row.authorId]?.ed25519;
    if (!authorKey) continue;
    const ck = `${row.authorId}/${row.epochId}`;
    if (!cache.has(ck)) cache.set(ck, keyring(row.authorId, row.epochId));
    const kr = cache.get(ck);
    if (!kr) continue;
    let opened: Core.OpenedPost;
    try {
      opened = kr.openPost(fromB64(authorKey), uuidToBytes(row.authorId), uuidToBytes(row.postId), uuidToBytes(row.epochId), fromB64(row.keyRef), fromB64(row.headerCt));
    } catch {
      continue; // not in this post's audience (or tampered)
    }
    const media = matchMedia(opened.content.media, row.media ?? []);
    if (!media) continue; // server's media list doesn't match the signed header
    posts.push({
      postId: row.postId,
      authorId: row.authorId,
      epochId: row.epochId,
      createdAtMs: Number(opened.content.createdAtMs),
      text: opened.content.text,
      media,
      mine,
      circle: mine ? book.postCircles?.[row.postId] : undefined,
      postKey: opened.postKey,
      readToken: Core.postReadToken(opened.postKey),
      replyCount: 0,
      likeCount: 0,
      likedByMe: false,
    });
  }
  return posts;
}

/** Picks up keys from rotations I haven't seen yet (CRYPTO.md 8.4) for any author whose rows use an unknown epoch. */
async function refreshUnknownEpochs(account: StoredAccount, book: AddressBook, rows: PostRow[]): Promise<AddressBook> {
  const stale = new Set<string>();
  for (const r of rows) {
    if (!r.authorId || !r.epochId || r.authorId === account.userId) continue;
    const c = book.contacts[r.authorId];
    if (c && !c.keys.some((k) => k.epochId === r.epochId)) stale.add(r.authorId);
  }
  if (stale.size === 0) return book;
  await Promise.all([...stale].map((id) => refreshContact(account, id).catch(() => undefined)));
  return loadAddressBook(account);
}

export type Page = { posts: FeedPost[]; cursor?: string; hasMore: boolean };

/** Fills in reply/like counts for posts I opened, proving audience membership with each post's read token. */
export async function withStats(posts: FeedPost[]): Promise<FeedPost[]> {
  if (posts.length === 0) return posts;
  const res = await api.POST('/v1/posts/stats', { body: { items: posts.map((p) => ({ postId: p.postId, readToken: toB64(p.readToken) })) } });
  if (!res.response.ok || !res.data) return posts; // counts are cosmetic; the posts still show
  const byId = new Map(res.data.map((s) => [s.postId, s]));
  return posts.map((p) => {
    const s = byId.get(p.postId);
    return s ? { ...p, replyCount: s.replyCount ?? 0, likeCount: s.likeCount ?? 0, likedByMe: !!s.likedByMe } : p;
  });
}

async function readPage(account: StoredAccount, rows: PostRow[], limit: number): Promise<Page> {
  const book = await refreshUnknownEpochs(account, await loadAddressBook(account), rows);
  const posts = await withStats(openRows(account, book, rows, (author, epoch) => keyringFor(account, book, author, epoch)));
  return { posts, cursor: rows.length ? rows[rows.length - 1].createdAt : undefined, hasMore: rows.length === limit };
}

/** One page of the timeline (me + friends), newest first. Unreadable rows are dropped, so a page may be short. */
export async function fetchFeedPage(account: StoredAccount, before?: string, limit = 50): Promise<Page> {
  const rows = ok(await api.GET('/v1/feed', { params: { query: { before, limit } } }));
  return readPage(account, rows, limit);
}

/** One page of a single author's posts that I can read. */
export async function fetchAuthorPosts(account: StoredAccount, authorId: string, opts: { before?: string; limit?: number } = {}): Promise<Page> {
  const limit = opts.limit ?? 30;
  const rows = ok(await api.GET('/v1/users/{userId}/posts', { params: { path: { userId: authorId }, query: { before: opts.before, limit } } }));
  return readPage(account, rows, limit);
}

/**
 * "Preview as…": my posts exactly as `friendId` can open them, using the circle key they were given in each epoch
 * (ReaderKeyring.forCircle). Epochs where they got no keys (before we were friends) open nothing, just as for them.
 */
export async function previewAs(account: StoredAccount, friendId: string, before?: string, limit = 50): Promise<Page> {
  const book = await loadAddressBook(account);
  const current = book.myEpochs[book.myEpochs.length - 1]?.epochId;
  const rows = ok(await api.GET('/v1/users/{userId}/posts', { params: { path: { userId: account.userId }, query: { before, limit } } }));
  const posts = openRows(account, book, rows, (_author, epochId) => {
    const epoch = book.myEpochs.find((e) => e.epochId === epochId);
    const circle = epoch?.placements?.[friendId] ?? (epochId === current ? book.contacts[friendId]?.circle : undefined);
    return epoch && circle ? Core.ReaderKeyring.forCircle(fromB64(epoch.root), circle) : null;
  }).map((p) => ({ ...p, mine: false, circle: undefined }));
  return { posts, cursor: rows.length ? rows[rows.length - 1].createdAt : undefined, hasMore: rows.length === limit };
}

/** Default audience for the composer: the last circle I posted to; before my first post, "Me only" (nothing is shared by accident). */
export function defaultCircle(book: Pick<AddressBook, 'lastCircle'>): number {
  return book.lastCircle ?? 1;
}
