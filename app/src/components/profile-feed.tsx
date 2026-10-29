import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactElement } from "react";
import { FlatList, Pressable, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { usePostActions } from "@/components/post-actions";
import { PostCard } from "@/components/post-card";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { loadAddressBook, type AddressBook } from "@/lib/addressbook";
import { putPosts, useFeed } from "@/lib/feed-store";
import type { StoredAccount } from "@/lib/keystore";
import { fetchAuthorPosts, type FeedPost } from "@/lib/posts";
import { postsForTab, profileTabs, type ProfileTab } from "@/lib/view-logic";

const TAB_LABEL: Record<ProfileTab, string> = {
  posts: "Posts",
  media: "Media",
  likes: "Likes",
};

type Props = {
  account: StoredAccount;
  userId: string;
  name: string;
  handle?: string;
  bio?: string;
  friendCount?: number;
  /** Buttons under the bio (Edit profile, Preview as…, Move, Unfriend…). */
  actions?: ReactElement;
  /** Buttons on the right of the avatar, X / Bluesky style. */
  headerRight?: ReactElement;
  /** Extra content above the tabs (e.g. the fingerprint box). */
  extra?: ReactElement;
};

/** Profile (PLAN.md 2A): banner, avatar, name, @handle, bio, friend count, then Posts | Media | Likes. */
export function ProfileFeed({
  account,
  userId,
  name,
  handle,
  bio,
  friendCount,
  actions,
  headerRight,
  extra,
}: Props) {
  const own = userId === account.userId;
  const timeline = useFeed();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [tab, setTab] = useState<ProfileTab>("posts");
  const [authored, setAuthored] = useState<FeedPost[] | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(() => {
    loadAddressBook(account).then(setBook, () => {});
    fetchAuthorPosts(account, userId).then(
      (page) => {
        putPosts(page.posts);
        setAuthored(page.posts);
        setCursor(page.cursor);
        setHasMore(page.hasMore);
      },
      () => setAuthored([]),
    );
  }, [account, userId]);
  useFocusEffect(load);
  const actionsFor = usePostActions(account, book, { onChange: load });

  const more = async () => {
    if (!hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchAuthorPosts(account, userId, { before: cursor });
      putPosts(page.posts);
      setAuthored((prev) => [...(prev ?? []), ...page.posts]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  };

  // Prefer the live copy from the store so likes and reply counts stay in sync with the thread view.
  const live = (authored ?? []).map(
    (p) => timeline.posts.find((t) => t.postId === p.postId) ?? p,
  );
  const data = postsForTab(tab, live, timeline.posts);

  return (
    <>
      <FlatList
        className="flex-1 bg-surface dark:bg-surface-dark"
        data={data}
        keyExtractor={(p) => p.postId}
        onEndReached={tab === "likes" ? undefined : more}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View>
            <View className="h-28 bg-primary-soft dark:bg-primary-soft-dark" />
            <View className="-mt-10 gap-2 px-4">
              <View className="flex-row items-end justify-between">
                <View className="rounded-full border-4 border-surface dark:border-surface-dark">
                  <Avatar size="lg" name={name} />
                </View>
                {headerRight ? <View className="mb-1 flex-row items-center gap-2">{headerRight}</View> : null}
              </View>
              <Text className="text-2xl font-bold text-ink dark:text-ink-dark">
                {name}
              </Text>
              {handle ? (
                <Text className="text-muted dark:text-muted-dark">
                  @{handle}
                </Text>
              ) : null}
              {bio ? (
                <Text className="text-base text-ink dark:text-ink-dark">
                  {bio}
                </Text>
              ) : null}
              {friendCount !== undefined ? (
                <Text className="text-muted dark:text-muted-dark">
                  <Text className="font-bold text-ink dark:text-ink-dark">
                    {friendCount}
                  </Text>{" "}
                  {friendCount === 1 ? "person" : "people"}
                </Text>
              ) : null}
              {actions}
              {extra}
            </View>
            <View
              className="mt-3 flex-row border-b border-border dark:border-border-dark"
              accessibilityRole="tablist"
            >
              {profileTabs(own).map((t) => (
                <Pressable
                  key={t}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t }}
                  onPress={() => setTab(t)}
                  className="flex-1 items-center pt-3"
                >
                  <Text
                    className={
                      tab === t
                        ? "font-bold text-ink dark:text-ink-dark"
                        : "text-muted dark:text-muted-dark"
                    }
                  >
                    {TAB_LABEL[t]}
                  </Text>
                  <View
                    className={`mt-3 h-1 w-14 rounded-full ${tab === t ? "bg-primary dark:bg-primary-dark" : "bg-transparent"}`}
                  />
                </Pressable>
              ))}
            </View>
            {authored === null ? <Spinner className="py-8" /> : null}
          </View>
        }
        ListEmptyComponent={
          authored === null ? undefined : (
            <Text className="px-6 py-10 text-center text-muted dark:text-muted-dark">
              {tab === "likes"
                ? "Posts you like appear here."
                : tab === "media"
                  ? "No photos or videos yet."
                  : "No posts yet."}
            </Text>
          )
        }
        ListFooterComponent={
          loadingMore ? <Spinner className="py-6" /> : undefined
        }
        renderItem={({ item }) => (
          <PostCard post={item} {...actionsFor.cardProps(item)} />
        )}
      />
      {actionsFor.sheet}
    </>
  );
}
