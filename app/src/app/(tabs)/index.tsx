import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { HomeHeader } from '@/components/home-header';
import { IntegrityBanner } from '@/components/integrity-banner';
import { OutboxCard, PostCard } from '@/components/post-card';
import { usePostActions } from '@/components/post-actions';
import { Screen } from '@/components/screen';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { resumePendingRotation } from '@/lib/circles';
import { checkForNewPosts, loadMoreFeed, refreshFeed, showPendingPosts, useFeed } from '@/lib/feed-store';
import { syncMessaging } from '@/lib/messaging';
import { dismissPost, retryPost, useOutbox } from '@/lib/outbox';
import { onPushActivity, registerForPush } from '@/lib/push';
import type { FeedPost } from '@/lib/posts';
import type { Connection } from '@/lib/friends';
import { useSession } from '@/lib/session';
import { useConnections } from '@/lib/use-connections';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';

const NEW_POSTS_INTERVAL = 60_000;

/** Home timeline (PLAN.md 2A): FlashList, pull-to-refresh, infinite scroll, "New posts" pill, header hides on scroll. */
/** The empty timeline nudges the next useful step: invite someone, answer a request, or post first. */
function HomeEmptyState({ connections }: { connections: Connection[] | null }) {
  const friends = (connections ?? []).filter((c) => c.status === 'accepted').length;
  const requests = (connections ?? []).filter((c) => c.status === 'incoming').length;
  if (friends > 0) {
    return (
      <EmptyState
        title="No posts yet"
        body={`You have ${friends} ${friends === 1 ? 'person' : 'people'} here. When they share something with you, it shows up here. Why not start? Only the circles you choose can read it.`}
        actionLabel="Write a post"
        onAction={() => router.push('/compose')}
      />
    );
  }
  if (requests > 0) {
    return (
      <EmptyState
        title="Someone wants to connect"
        body="Accept their request to start sharing. You choose which circles they’re in."
        actionLabel="Review request"
        onAction={() => router.navigate({ pathname: '/search', params: { section: 'friends' } })}
      />
    );
  }
  return (
    <EmptyState
      title="Your timeline is quiet"
      body="Posts from your people appear here. Only people in the circles you choose can read what you share."
      actionLabel="Invite your first person"
      onAction={() => router.navigate({ pathname: '/search', params: { section: 'invite' } })}
    />
  );
}

export default function HomeScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const { connections } = useConnections();
  const outbox = useOutbox();
  const feed = useFeed();
  const [book, setBook] = useState<AddressBook | null>(null);
  const actions = usePostActions(account, book);
  const list = useRef<{ scrollToOffset: (o: { offset: number; animated?: boolean }) => void } | null>(null);

  // Finish any key rotation that was interrupted (app closed mid-way, offline): it retries quietly in the background.
  useEffect(() => {
    if (account) resumePendingRotation(account).catch(() => {});
  }, [account]);

  // Content-free pushes: register once, and on "new activity" just fetch and decrypt as usual.
  useEffect(() => {
    if (!account) return;
    registerForPush(account);
    return onPushActivity(() => {
      checkForNewPosts(account);
      syncMessaging(account).catch(() => {});
    });
  }, [account]);

  const refresh = useCallback(async () => {
    if (!account) return;
    setBook(await loadAddressBook(account).catch(() => null));
    await refreshFeed(account);
  }, [account]);

  // Load on focus; while focused, look for new posts every minute (they wait behind the pill).
  useFocusEffect(
    useCallback(() => {
      if (!account) return;
      refresh();
      const timer = setInterval(() => checkForNewPosts(account), NEW_POSTS_INTERVAL);
      return () => clearInterval(timer);
    }, [account, refresh]),
  );

  // Refresh when an upload finishes.
  const finished = outbox.filter((i) => i.status === 'done').length;
  const seen = useRef(finished);
  useEffect(() => {
    if (finished > seen.current) refresh();
    seen.current = finished;
  }, [finished, refresh]);

  // Header hides on scroll down and comes back on scroll up.
  const [headerHeight, setHeaderHeight] = useState(0);
  const offset = useSharedValue(0);
  const lastY = useRef(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    if (y <= 0 || dy < -8) offset.value = withTiming(0, { duration: 180 });
    else if (dy > 8 && y > headerHeight) offset.value = withTiming(-headerHeight, { duration: 180 });
    lastY.current = y;
  };
  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  if (!account) return null;
  const pending = outbox.filter((i) => i.status !== 'done');

  return (
    <Screen>
      <FlashList
        ref={(r) => {
          list.current = r;
        }}
        data={feed.posts}
        keyExtractor={(p: FeedPost) => p.postId}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={refresh} progressViewOffset={headerHeight} />}
        onEndReached={() => loadMoreFeed(account)}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <>
            {/* Spacer the size of the floating header (same component, invisible), so the first post isn't covered. */}
            <View className="opacity-0" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <HomeHeader />
            </View>
            <IntegrityBanner />
            {pending.map((i) => (
              <OutboxCard key={i.id} item={i} onRetry={() => retryPost(account, i.id)} onDismiss={() => dismissPost(i.id)} />
            ))}
            {feed.error ? <Text className="px-4 py-2 text-center text-sm text-danger dark:text-danger-dark">{feed.error}</Text> : null}
          </>
        }
        ListEmptyComponent={
          pending.length || !feed.loaded ? undefined : (
            <View className="h-[560px]">
              <HomeEmptyState connections={connections} />
            </View>
          )
        }
        ListFooterComponent={feed.loading ? <Spinner className="py-6" /> : null}
        renderItem={({ item }: { item: FeedPost }) => <PostCard post={item} {...actions.cardProps(item)} />}
      />

      <Animated.View
        className="absolute left-0 right-0 top-0"
        style={headerStyle}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
        <HomeHeader />
        {feed.pending.length ? (
          <View pointerEvents="box-none" className="absolute left-0 right-0 top-full items-center pt-3">
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                showPendingPosts();
                list.current?.scrollToOffset({ offset: 0, animated: true });
              }}
              className="rounded-full bg-primary px-4 py-2 shadow-lg active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark">
              <Text className="font-bold text-on-primary dark:text-on-primary-dark">
                ↑ {feed.pending.length} new {feed.pending.length === 1 ? 'post' : 'posts'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.View>

      <Fab accessibilityLabel="Compose post" icon="add" onPress={() => router.push('/compose')} />
      {actions.sheet}
    </Screen>
  );
}
