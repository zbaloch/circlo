/**
 * Posts (PLAN.md Phase 7, CRYPTO.md section 8). The header (text, media keys, mime types, sizes) is sealed by the core
 * under a per-post key derived from my circle chain; the server sees only an opaque header, a key ref that reveals
 * neither the circle nor which posts share an audience, and random object keys. The circle a post went to is kept
 * only in my encrypted address book, so only I ever see it.
 */
import * as Core from '@halqo/core';

import { api, ok } from '@/api/client';

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
};

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

/** The keys I hold for an author's epoch: my own chain root, or the circle key a friend gave me. */
function keyringFor(account: StoredAccount, book: AddressBook, authorId: string, epochId: string): Core.ReaderKeyringLike | null {
  if (authorId === account.userId) {
    const mine = book.myEpochs.find((e) => e.epochId === epochId);
    return mine ? Core.ReaderKeyring.forOwner(fromB64(mine.root)) : null;
  }
  const key = book.contacts[authorId]?.keys.find((k) => k.epochId === epochId);
  return key ? new Core.ReaderKeyring(fromB64(key.circleKey)) : null;
}

/**
 * An author's posts that I can read, newest first. Posts for circles I'm not in (or from epochs I was never given)
 * fail to open and are silently skipped; the server can't tell which ones I could read.
 */
export async function fetchAuthorPosts(account: StoredAccount, authorId: string, opts: { before?: string; limit?: number } = {}) {
  let book = await loadAddressBook(account);
  const mine = authorId === account.userId;
  const authorKey = mine ? account.ed25519Pk : book.contacts[authorId]?.ed25519;
  if (!authorKey) return { posts: [] as FeedPost[], cursor: undefined };
  const rows = ok(await api.GET('/v1/users/{userId}/posts', { params: { path: { userId: authorId }, query: { before: opts.before, limit: opts.limit ?? 30 } } }));
  // A post from an epoch I hold no key for: the author may have rotated (CRYPTO.md 8.4) and sent me a new payload.
  const known = (epochId: string) => (mine ? book.myEpochs.some((e) => e.epochId === epochId) : book.contacts[authorId]?.keys.some((k) => k.epochId === epochId));
  if (!mine && rows.some((r) => r.epochId && !known(r.epochId))) {
    await refreshContact(account, authorId).catch(() => undefined);
    book = await loadAddressBook(account);
  }
  const keyrings = new Map<string, Core.ReaderKeyringLike | null>();
  const posts: FeedPost[] = [];
  for (const row of rows) {
    if (!row.postId || !row.epochId || !row.keyRef || !row.headerCt) continue;
    if (!keyrings.has(row.epochId)) keyrings.set(row.epochId, keyringFor(account, book, authorId, row.epochId));
    const kr = keyrings.get(row.epochId);
    if (!kr) continue;
    let opened: Core.OpenedPost;
    try {
      opened = kr.openPost(fromB64(authorKey), uuidToBytes(authorId), uuidToBytes(row.postId), uuidToBytes(row.epochId), fromB64(row.keyRef), fromB64(row.headerCt));
    } catch {
      continue; // not in this post's audience (or tampered)
    }
    const media = matchMedia(opened.content.media, row.media ?? []);
    if (!media) continue; // server's media list doesn't match the signed header
    posts.push({
      postId: row.postId,
      authorId,
      createdAtMs: Number(opened.content.createdAtMs),
      text: opened.content.text,
      media,
      mine,
      circle: mine ? book.postCircles?.[row.postId] : undefined,
    });
  }
  return { posts, cursor: rows.length ? rows[rows.length - 1].createdAt : undefined };
}

/** Basic timeline: my posts and every friend's readable posts, newest first. (Phase 8 adds paging and FlashList.) */
export async function fetchTimeline(account: StoredAccount): Promise<FeedPost[]> {
  const book = await loadAddressBook(account);
  const authors = [account.userId, ...Object.keys(book.contacts)];
  const results = await Promise.all(authors.map((id) => fetchAuthorPosts(account, id).then((r) => r.posts, () => [] as FeedPost[])));
  return results.flat().sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/** Default audience for the composer: the last circle I posted to; before my first post, "Me only" (nothing is shared by accident). */
export function defaultCircle(book: Pick<AddressBook, 'lastCircle'>): number {
  return book.lastCircle ?? 1;
}
