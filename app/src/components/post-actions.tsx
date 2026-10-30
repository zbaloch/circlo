import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { type AddressBook } from '@/lib/addressbook';
import { blockUser } from '@/lib/blocks';
import { audienceLabel } from '@/lib/circles';
import { getPost, openViewer, putPost, removePost } from '@/lib/feed-store';
import type { StoredAccount } from '@/lib/keystore';
import { getMyName } from '@/lib/my-name';
import { deletePost, type FeedPost } from '@/lib/posts';
import { loadModerationKey } from '@/lib/report';
import { setLiked, toggledLike } from '@/lib/thread';
import { showAlert } from '@/lib/dialog';

/** Display name for an author: me, a friend's decrypted profile name, or a neutral fallback. Pure. */
export function authorName(account: Pick<StoredAccount, 'userId' | 'handle'>, book: Pick<AddressBook, 'contacts'> | null, authorId: string) {
  if (authorId === account.userId) return { name: getMyName() ?? account.handle, handle: account.handle };
  const c = book?.contacts[authorId];
  return { name: c?.displayName || (c?.handle ? `@${c.handle}` : 'Someone'), handle: c?.handle };
}

/** An author's profile: mine, or a friend's page with their posts. */
export function openProfile(account: { userId: string } | null, userId: string) {
  if (account && userId === account.userId) router.push('/profile');
  else router.push({ pathname: '/friend/[id]', params: { id: userId } });
}

/** The author-only audience badge ("Everyone", "Family, Kids"). Only ever computed for my own posts. Pure. */
export function audienceBadge(book: Pick<AddressBook, 'circleDefs'> | null, post: Pick<FeedPost, 'mine' | 'audience'>): string | undefined {
  if (!post.mine || !post.audience || !book) return undefined;
  return audienceLabel(book, post.audience);
}

/** Everything a post card needs, shared by Home, the thread view and profiles. */
export function usePostActions(account: StoredAccount | null, book: AddressBook | null, opts: { inThread?: boolean; onChange?: () => void } = {}) {
  const like = async (post: FeedPost) => {
    const next = toggledLike(post);
    putPost(next);
    try {
      await setLiked(post, next.likedByMe);
    } catch {
      putPost(getPost(post.postId) === next ? post : (getPost(post.postId) ?? post)); // roll back
    }
  };

  // Report shows only when this server has a moderation key (reporting set up).
  const [canReport, setCanReport] = useState(false);
  useEffect(() => {
    loadModerationKey().then((k) => setCanReport(!!k), () => setCanReport(false));
  }, []);

  const more = (post: FeedPost) => {
    if (!account) return;
    if (!post.mine) {
      const { name } = authorName(account, book, post.authorId);
      const block = () =>
        showAlert(`Block ${name}?`, 'You’ll stop being connected. They can’t send you requests or see anything new you post, and their messages are hidden. They aren’t told.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block',
            style: 'destructive',
            onPress: () => blockUser(account, post.authorId).then(() => opts.onChange?.(), () => showAlert('Couldn’t block', 'Check your connection and try again.')),
          },
        ]);
      showAlert('Post options', undefined, [
        ...(canReport ? [{ text: 'Report post', style: 'destructive' as const, onPress: () => router.push({ pathname: '/report/[id]', params: { id: post.postId } }) }] : []),
        { text: `Block ${name}`, style: 'destructive', onPress: block },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    showAlert('Delete post?', 'It will be removed for everyone who could see it, with its replies and likes.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deletePost(account, post.postId).then(() => {
            removePost(post.postId);
            opts.onChange?.();
            if (opts.inThread) router.back();
          }, () => showAlert('Couldn’t delete', 'Check your connection and try again.')),
      },
    ]);
  };

  const cardProps = (post: FeedPost) => {
    const open = () => router.push({ pathname: '/post/[id]', params: { id: post.postId } });
    return {
      ...(account ? authorName(account, book, post.authorId) : { name: '' }),
      audience: audienceBadge(book, post),
      onOpen: opts.inThread ? undefined : open,
      // X style: the reply icon opens the reply composer, with the post shown above it.
      onReply: () => router.push({ pathname: '/reply/[id]', params: { id: post.postId } }),
      onAuthor: () => openProfile(account, post.authorId),
      onLike: () => like(post),
      onMore: () => more(post),
      onMediaPress: (index: number) => {
        openViewer(post.media.filter((m) => m.kind === 'full'), index);
        router.push('/viewer');
      },
    };
  };

  return { cardProps, sheet: null };
}
