import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { OutboxCard, PostCard } from '@/components/post-card';
import { Screen } from '@/components/screen';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { labelOf, resumePendingRotation } from '@/lib/circles';
import { dismissPost, retryPost, useOutbox } from '@/lib/outbox';
import { deletePost, fetchTimeline, type FeedPost } from '@/lib/posts';
import { useSession } from '@/lib/session';

/** Home: my posts and friends' readable posts. Phase 8 turns this into the full FlashList timeline. */
export default function HomeScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const outbox = useOutbox();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [book, setBook] = useState<AddressBook | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Finish any key rotation that was interrupted (app closed mid-way, offline): it retries quietly in the background.
  useEffect(() => {
    if (account) resumePendingRotation(account).catch(() => {});
  }, [account]);

  const load = useCallback(async () => {
    if (!account) return;
    setRefreshing(true);
    try {
      const [p, b] = await Promise.all([fetchTimeline(account), loadAddressBook(account)]);
      setPosts(p);
      setBook(b);
    } catch {
      // keep what's on screen; pull to retry
    } finally {
      setRefreshing(false);
    }
  }, [account]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Refresh when an upload finishes.
  const finished = outbox.filter((i) => i.status === 'done').length;
  const seen = useRef(finished);
  useEffect(() => {
    if (finished > seen.current) load();
    seen.current = finished;
  }, [finished, load]);

  if (!account) return null;
  const pending = outbox.filter((i) => i.status !== 'done');

  const nameOf = (p: FeedPost) => {
    if (p.mine) return { name: account.handle, handle: account.handle };
    const c = book?.contacts[p.authorId];
    return { name: c?.displayName || (c?.handle ? `@${c.handle}` : 'Friend'), handle: c?.handle };
  };

  const confirmDelete = (p: FeedPost) =>
    Alert.alert('Delete post?', 'It will be removed for everyone who could see it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePost(account, p.postId).then(load, () => {}) },
    ]);

  return (
    <Screen>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.postId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        ListHeaderComponent={
          <>
            {pending.map((i) => (
              <OutboxCard key={i.id} item={i} onRetry={() => retryPost(account, i.id)} onDismiss={() => dismissPost(i.id)} />
            ))}
          </>
        }
        ListEmptyComponent={
          pending.length || refreshing ? undefined : (
            <EmptyState
              title="Your timeline is quiet"
              body="Posts from friends appear here. Only people in the circles you choose can read what you share."
              actionLabel="Invite your first friend"
              onAction={() => router.push('/search')}
            />
          )
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            {...nameOf(item)}
            audience={item.mine && item.circle && book ? `${labelOf(book, item.circle)}${item.circle > 1 ? '+' : ''}` : undefined}
            onDelete={item.mine ? () => confirmDelete(item) : undefined}
          />
        )}
      />
      <Fab accessibilityLabel="Compose post" icon="add" onPress={() => router.push('/compose')} />
    </Screen>
  );
}
