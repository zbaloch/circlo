import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactElement } from "react";
import { FlatList, Pressable, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { usePostActions } from "@/components/post-actions";
import { PostCard } from "@/components/post-card";
import { ReplyCard } from "@/components/reply-card";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { loadAddressBook, type AddressBook } from "@/lib/addressbook";
import { putPosts, useFeed } from "@/lib/feed-store";
import type { StoredAccount } from "@/lib/keystore";
import { fetchAuthorPosts, type FeedPost } from "@/lib/posts";
import { fetchUserReplies, type UserReply } from "@/lib/thread";
import { useNow } from "@/lib/use-now";
import { postsForTab, profileTabs, type ProfileTab } from "@/lib/view-logic";

const TAB_LABEL: Record<ProfileTab, string> = {
  posts: "Posts",
  replies: "Replies",
  media: "Media",
  likes: "Likes",
};

type Props = {
  account: StoredAccount;
  userId: string;
  name: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string | null;
  friendCount?: number;
  /** Buttons under the bio (Edit profile, Preview as…, Move, Unfriend…). */
  actions?: ReactElement;
  /** Buttons on the right of the avatar, X / Bluesky style. */
  headerRight?: ReactElement;
  /** Extra content above the tabs. */
  extra?: ReactElement;
};

/**
 * Profile (PLAN.md 2A): banner, avatar, name, @handle, bio, friend count, then Posts | Replies | Media | Likes. Replies
 * lists their replies on posts I can see, each with the post it answers.
 */
export function ProfileFeed({
  account,
  userId,
  name,
  handle,
  bio,
  avatarUrl,
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
  const [replies, setReplies] = useState<UserReply[] | null>(null);
  const [repliesMore, setRepliesMore] = useState(true);
  const now = useNow();

  const loadReplies = useCallback(() => {
    fetchUserReplies(account, userId).then(
      (r) => {
        setReplies(r);
        setRepliesMore(r.length >= 30);
      },
      () => setReplies([]),
    );
  }, [account, userId]);

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
  useFocusEffect(
    useCallback(() => {
      if (tab === "replies") loadReplies();
    }, [tab, loadReplies]),
  );
  const actionsFor = usePostActions(account, book, { onChange: load });

  const more = async () => {
    if (tab === "replies") {
      const last = replies?.[replies.length - 1];
      if (!last || !repliesMore || loadingMore) return;
      setLoadingMore(true);
      try {
        const page = await fetchUserReplies(account, userId, new Date(last.reply.createdAtMs).toISOString());
        setReplies((prev) => [...(prev ?? []), ...page]);
        setRepliesMore(page.length >= 30);
      } finally {
        setLoadingMore(false);
      }
      return;
    }
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
  type Row = { key: string; post?: FeedPost; reply?: UserReply };
  const data: Row[] =
    tab === "replies"
      ? (replies ?? []).map((r) => ({ key: r.reply.replyId, reply: r }))
      : postsForTab(tab, live, timeline.posts).map((p) => ({ key: p.postId, post: p }));
  const waiting = tab === "replies" ? replies === null : authored === null;

  return (
    <>
      <FlatList
        className="flex-1 bg-surface dark:bg-surface-dark"
        data={data}
        keyExtractor={(r) => r.key}
        onEndReached={tab === "likes" ? undefined : more}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View>
            <View className="h-28 bg-primary-soft dark:bg-primary-soft-dark" />
            <View className="-mt-10 gap-2 px-4">
              <View className="flex-row items-end justify-between">
                <View className="rounded-full border-4 border-surface dark:border-surface-dark">
                  <Avatar size="lg" id={userId} name={name} uri={avatarUrl} />
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
                  onPress={() => {
                    setTab(t);
                    if (t === "replies" && replies === null) loadReplies();
                  }}
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
            {waiting ? <Spinner className="py-8" /> : null}
          </View>
        }
        ListEmptyComponent={
          waiting ? undefined : (
            <Text className="px-6 py-10 text-center text-muted dark:text-muted-dark">
              {tab === "likes"
                ? "Posts you like appear here."
                : tab === "replies"
                  ? "No replies yet."
                : tab === "media"
                  ? "No photos or videos yet."
                  : "No posts yet."}
            </Text>
          )
        }
        ListFooterComponent={
          loadingMore ? <Spinner className="py-6" /> : undefined
        }
        renderItem={({ item }) =>
          item.reply ? (
            <ReplyCard item={item.reply} now={now} />
          ) : item.post ? (
            <PostCard post={item.post} {...actionsFor.cardProps(item.post)} />
          ) : null
        }
      />
      {actionsFor.sheet}
    </>
  );
}
