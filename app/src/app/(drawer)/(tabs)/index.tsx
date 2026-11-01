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
import { checkForNewPosts, loadMoreFeed, refreshFeed, showPendingPosts, useFeed } from '@/lib/feed-store';
import { onLiveChange } from '@/lib/live';
import { pushRoute } from '@/lib/push-route';
import { dismissPost, retryPost, useOutbox } from '@/lib/outbox';
import { offerBackgroundChecksNow, onNotificationOpened } from '@/lib/background-check';
import type { StoredAccount } from '@/lib/keystore';
import { newSignIns } from '@/lib/security-events';
import type { FeedPost } from '@/lib/posts';
import type { Connection } from '@/lib/friends';
import { refreshMe } from '@/lib/me';
import { useSession } from '@/lib/session';
import { useConnections } from '@/lib/use-connections';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';

const NEW_POSTS_INTERVAL = 60_000;

/** A password login on another device that this phone hasn't shown yet opens "New sign-in to your account". */
function checkSignIns(account: StoredAccount) {
  newSignIns(account).then((signIns) => signIns.length && router.push('/security-alert'), () => undefined);
}

/** Home timeline (PLAN.md 2A): FlashList, pull-to-refresh, infinite scroll, "New posts" pill, header hides on scroll. */
/** The empty timeline nudges the next useful step: invite someone, answer a request, or post first. */
function HomeEmptyState({ connections }: { connections: Connection[] | null }) {
  const friends = (connections ?? []).filter((c) => c.status === 'accepted').length;
  const requests = (connections ?? []).filter((c) => c.status === 'incoming').length;
  if (friends > 0) {
    return (
      <EmptyState
        icon="pencil-outline"
        title="No posts yet"
        body={`You have ${friends} ${friends === 1 ? 'person' : 'people'} here. When they share something with you, it shows up here. Why not start? Only the circles you choose can see it.`}
        actionLabel="Write a post"
        onAction={() => router.push('/compose')}
      />
    );
  }
  if (requests > 0) {
    return (
      <EmptyState
        icon="person-add-outline"
        title="Someone wants to connect"
        body="Accept their request to start sharing. You choose which circles they’re in."
        actionLabel="Review request"
        onAction={() => router.navigate({ pathname: '/search', params: { section: 'friends' } })}
      />
    );
  }
  return (
    <EmptyState
      icon="people-outline"
      title="Your timeline is quiet"
      body="Posts from your people appear here. Only people in the circles you choose can see what you share."
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

  // No remote push: if notifications haven't been asked about yet, Circlo's own screen offers background checks first
  // (the system popup only follows a "yes" there). Tapping one of their notifications opens the Notifications tab.
  useEffect(() => {
    if (!account) return;
    offerBackgroundChecksNow().then((offer) => offer && router.push('/enable-notifications'));
    // A tapped notification opens what it's about: the reply, the chat or the requests.
    return onNotificationOpened((data) => router.navigate(pushRoute(data)));
  }, [account]);

  const refresh = useCallback(async () => {
    if (!account) return;
    // My name and photo for my own posts.
    await refreshMe().catch(() => null);
    setBook(await loadAddressBook(account).catch(() => null));
    await refreshFeed(account);
  }, [account]);
  // The spinner shows only for a pull: switching it on from code (focus refreshes) makes iOS push the timeline down.
  const [pulling, setPulling] = useState(false);
  const pull = useCallback(async () => {
    setPulling(true);
    await refresh();
    setPulling(false);
  }, [refresh]);

  // Load on focus; while focused, look for new posts every minute (they wait behind the pill).
  useFocusEffect(
    useCallback(() => {
      if (!account) return;
      refresh();
      checkSignIns(account);
      const timer = setInterval(() => checkForNewPosts(account), NEW_POSTS_INTERVAL);
      // A friend's new post shows the "New posts" pill right away.
      const off = onLiveChange(() => checkForNewPosts(account));
      return () => {
        clearInterval(timer);
        off();
      };
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
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} progressViewOffset={headerHeight} />}
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

      {/* Positioned by a plain View: the web drops classes on Reanimated views (reanimated-classes.test.ts). */}
      <View pointerEvents="box-none" className="absolute left-0 right-0 top-0">
        <Animated.View style={headerStyle} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
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
      </View>

      <Fab accessibilityLabel="Compose post" icon="add" onPress={() => router.push('/compose')} />
      {actions.sheet}
    </Screen>
  );
}
