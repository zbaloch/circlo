/**
 * Safety and legal (PLAN.md Phase 11): blocking, account deletion, and an export of your own data decrypted on this
 * device. No cryptography is implemented here.
 */
import { Directory } from 'expo-file-system';

import { api, ok } from '@/api/client';

import { loadAddressBook } from './addressbook';
import { unfriend } from './circles';
import { loadMyProfile } from './friends';
import type { StoredAccount } from './keystore';
import { imageUri } from './media';
import { conversationsSnapshot } from './messaging';
import { fetchAuthorPosts } from './posts';

/** Blocks someone: unfriend first (rotates my keys so they can't read anything new), then block on the server. */
export async function blockUser(account: StoredAccount, userId: string): Promise<void> {
  const book = await loadAddressBook(account);
  if (book.contacts[userId]) await unfriend(account, userId).catch(() => undefined);
  ok(await api.POST('/v1/blocks/{userId}', { params: { path: { userId } } }));
}

export async function unblockUser(userId: string): Promise<void> {
  ok(await api.DELETE('/v1/blocks/{userId}', { params: { path: { userId } } }));
}

/** Deletes the account on the server (after the user retypes their handle). The caller then signs out locally. */
export async function deleteAccount(handle: string): Promise<void> {
  ok(await api.DELETE('/v1/account', { body: { handle } }));
}

// ---------------- data export ----------------

type ExportProgress = (step: string) => void;

/**
 * Exports my data, decrypted on this device: profile, friends (names as I see them), circle labels, my posts (text,
 * time, audience, photos), and my chats. Saved as one JSON file in a folder the user picks; nothing goes to the
 * server.
 */
export async function exportMyData(account: StoredAccount, onProgress?: ExportProgress): Promise<string> {
  const folder = await Directory.pickDirectoryAsync();
  onProgress?.('Reading your profile and friends…');
  const [profile, book] = await Promise.all([loadMyProfile(account), loadAddressBook(account)]);
  onProgress?.('Decrypting your posts…');
  const posts: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 200; page++) {
    const res = await fetchAuthorPosts(account, account.userId, { before: cursor, limit: 50 });
    for (const p of res.posts) {
      const photos: string[] = [];
      for (const m of p.media.filter((x) => x.kind === 'full' && x.item.mime.startsWith('image/'))) {
        photos.push(await imageUri(m).catch(() => ''));
      }
      posts.push({
        postId: p.postId,
        createdAt: new Date(p.createdAtMs).toISOString(),
        text: p.text,
        audienceCircle: book.postCircles?.[p.postId] ?? null,
        photos: photos.filter(Boolean),
        videos: p.media.filter((m) => m.kind === 'full' && m.item.mime.startsWith('video/')).length,
      });
    }
    if (!res.hasMore || !res.cursor) break;
    cursor = res.cursor;
  }
  onProgress?.('Collecting your chats…');
  const chats = conversationsSnapshot().map((c) => ({
    members: c.members.map((u) => book.contacts[u]?.displayName || book.contacts[u]?.handle || u),
    messages: c.messages.map((m) => ({ at: new Date(m.createdAtMs).toISOString(), fromMe: m.mine, text: m.text })),
  }));
  const data = {
    exportedAt: new Date().toISOString(),
    app: 'Halqo',
    account: { handle: account.handle, userId: account.userId },
    profile,
    circleLabels: book.labels ?? {},
    friends: Object.entries(book.contacts).map(([id, c]) => ({ userId: id, name: c.displayName ?? null, handle: c.handle ?? null, circle: c.circle, verified: c.verified })),
    posts,
    chats,
  };
  onProgress?.('Saving…');
  const name = `halqo-export-${new Date().toISOString().slice(0, 10)}.json`;
  const file = folder.createFile(name, 'application/json');
  await file.write(JSON.stringify(data, null, 2));
  return name;
}
