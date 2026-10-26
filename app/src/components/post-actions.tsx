import { router } from 'expo-router';
import { Alert } from 'react-native';

import { updateAddressBook, type AddressBook } from '@/lib/addressbook';
import { labelOf } from '@/lib/circles';
import { getPost, openViewer, putPost, removePost } from '@/lib/feed-store';
import type { StoredAccount } from '@/lib/keystore';
import { deletePost, type FeedPost } from '@/lib/posts';
import { setLiked, toggledLike } from '@/lib/thread';

/** Display name for an author: me, a friend's decrypted profile name, or a neutral fallback. Pure. */
export function authorName(account: Pick<StoredAccount, 'userId' | 'handle'>, book: Pick<AddressBook, 'contacts'> | null, authorId: string) {
  if (authorId === account.userId) return { name: account.handle, handle: account.handle };
  const c = book?.contacts[authorId];
  return { name: c?.displayName || (c?.handle ? `@${c.handle}` : 'Friend'), handle: c?.handle };
}

/** The author-only audience badge ("Closest friends+"). Only ever computed for my own posts. Pure. */
export function audienceBadge(book: Pick<AddressBook, 'labels'> | null, post: Pick<FeedPost, 'mine' | 'circle'>): string | undefined {
  if (!post.mine || !post.circle || !book) return undefined;
  return `${labelOf(book, post.circle)}${post.circle > 1 ? '+' : ''}`;
}

/** Posts from authors I muted are hidden locally (the server never learns about mutes). Pure. */
export function visiblePosts(book: Pick<AddressBook, 'muted'> | null, posts: FeedPost[]): FeedPost[] {
  const muted = new Set(book?.muted ?? []);
  return muted.size ? posts.filter((p) => !muted.has(p.authorId)) : posts;
}

/** Everything a post card needs, shared by Home, the thread view and profiles. */
export function usePostActions(account: StoredAccount | null, book: AddressBook | null, opts: { inThread?: boolean; onChange?: () => void } = {}) {
  const like = async (post: FeedPost) => {
    const next = toggledLike(post);
    putPost(next);
    try {
      await setLiked(post.postId, next.likedByMe);
    } catch {
      putPost(getPost(post.postId) === next ? post : (getPost(post.postId) ?? post)); // roll back
    }
  };

  const more = (post: FeedPost) => {
    if (!account) return;
    if (post.mine) {
      Alert.alert('Delete post?', 'It will be removed for everyone who could see it, with its replies and likes.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deletePost(account, post.postId).then(() => {
              removePost(post.postId);
              opts.onChange?.();
              if (opts.inThread) router.back();
            }, () => Alert.alert('Couldn’t delete', 'Check your connection and try again.')),
        },
      ]);
      return;
    }
    const { name } = authorName(account, book, post.authorId);
    Alert.alert(name, 'Muting hides their posts from your timeline. Only you know; they aren’t told.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: `Mute ${name}`,
        onPress: () =>
          updateAddressBook(account, (b) => {
            b.muted = [...new Set([...(b.muted ?? []), post.authorId])];
          }).then(() => opts.onChange?.()),
      },
    ]);
  };

  const cardProps = (post: FeedPost) => {
    const open = () => router.push({ pathname: '/post/[id]', params: { id: post.postId } });
    return {
      ...(account ? authorName(account, book, post.authorId) : { name: '' }),
      audience: audienceBadge(book, post),
      onOpen: opts.inThread ? undefined : open,
      onReply: opts.inThread ? undefined : () => router.push({ pathname: '/post/[id]', params: { id: post.postId, reply: '1' } }),
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
