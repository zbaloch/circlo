import { Icon, type IconName } from '@/components/ui/icon';
import { useEffect } from 'react';
import { Linking, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Avatar } from '@/components/avatar';
import { MediaGrid } from '@/components/post-media';
import type { OutboxItem } from '@/lib/outbox';
import type { FeedPost } from '@/lib/posts';
import { fullTime, relativeTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';
import { linkParts } from '@/lib/view-logic';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';
import { LIKES_ENABLED } from '@/lib/features';

type Props = {
  post: FeedPost;
  name: string;
  handle?: string;
  avatarUrl?: string | null;
  /** Author-only audience label for my own posts, e.g. "Closest friends+". Never passed for other people's posts. */
  audience?: string;
  /** Opens the thread. Omitted inside the thread itself. */
  onOpen?: () => void;
  onReply?: () => void;
  onLike?: () => void;
  onMore?: () => void;
  onMediaPress?: (index: number) => void;
  /** Opens the author's profile (avatar or name). */
  onAuthor?: () => void;
};

function Action({ icon, label, count, active, onPress }: { icon: IconName; label: string; count?: number; active?: boolean; onPress?: () => void }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} hitSlop={8} className="flex-row items-center gap-1">
      <Icon name={icon} size={18} color={active ? palette.danger : palette.muted} />
      {count ? <Text className={active ? 'text-sm text-danger dark:text-danger-dark' : 'text-sm text-muted dark:text-muted-dark'}>{count}</Text> : null}
    </Pressable>
  );
}

/** Post card (PLAN.md 2A). No repost action, deliberately: resharing would leak a post beyond its circle. */
/** Post text with tappable links. */
export function PostText({ text, className }: { text: string; className: string }) {
  return (
    <Text className={className}>
      {linkParts(text).map((part, i) =>
        part.url ? (
          <Text key={i} accessibilityRole="link" onPress={() => Linking.openURL(part.url!)} className="text-primary dark:text-primary-dark">
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

/** The thread's main post, X style: author row, full-width text and media, the full time, then actions. */
export function PostDetail({ post, name, handle, avatarUrl, audience, onReply, onLike, onMore, onMediaPress, onAuthor }: Props) {
  const palette = usePalette();
  return (
    <View className="gap-3 border-b border-border px-4 pb-1 pt-3 dark:border-border-dark">
      <View className="flex-row items-center gap-3">
        <Pressable accessibilityRole="button" accessibilityLabel={`${name}'s profile`} onPress={onAuthor} disabled={!onAuthor} className="flex-1 flex-row items-center gap-3 active:opacity-70">
          <Avatar id={post.authorId} name={name} uri={avatarUrl} />
          <View className="flex-1">
            <Text numberOfLines={1} className="text-base font-bold text-ink dark:text-ink-dark">{name}</Text>
            {handle ? <Text numberOfLines={1} className="text-[15px] text-muted dark:text-muted-dark">@{handle}</Text> : null}
          </View>
        </Pressable>
        {onMore ? (
          <Pressable accessibilityRole="button" accessibilityLabel="More options" onPress={onMore} hitSlop={8}>
            <Icon name="ellipsis-horizontal" size={18} color={palette.muted} />
          </Pressable>
        ) : null}
      </View>
      {post.text ? <PostText text={post.text} className="text-[17px] leading-6 text-ink dark:text-ink-dark" /> : null}
      {post.media.length ? <MediaGrid media={post.media} onPress={onMediaPress} /> : null}
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-[15px] text-muted dark:text-muted-dark">{fullTime(post.createdAtMs)}</Text>
        {audience ? (
          <View className="flex-row items-center gap-1">
            <Icon name="lock-closed" size={12} color={palette.muted} />
            <Text className="text-[15px] text-muted dark:text-muted-dark">{audience}</Text>
          </View>
        ) : null}
      </View>
      <View className="flex-row items-center gap-10 border-t border-border py-3 dark:border-border-dark">
        <Action icon="chatbubble-outline" label={`Reply, ${post.replyCount} replies`} count={post.replyCount} onPress={onReply} />
        {LIKES_ENABLED ? (
          <Action icon={post.likedByMe ? 'heart' : 'heart-outline'} label={post.likedByMe ? 'Unlike' : 'Like'} count={post.likeCount} active={post.likedByMe} onPress={onLike} />
        ) : null}
      </View>
    </View>
  );
}

export function PostCard({ post, name, handle, avatarUrl, audience, onOpen, onReply, onLike, onMore, onMediaPress, onAuthor }: Props) {
  const now = useNow();
  const palette = usePalette();
  return (
    <Pressable onPress={onOpen} disabled={!onOpen} className="flex-row gap-3 border-b border-border px-4 py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}'s profile`} onPress={onAuthor} disabled={!onAuthor} className="self-start active:opacity-70">
        <Avatar id={post.authorId} name={name} uri={avatarUrl} />
      </Pressable>
      <View className="flex-1 gap-2">
        <View className="flex-row items-center gap-1">
          <Text numberOfLines={1} onPress={onAuthor} className="shrink text-[15px] font-bold text-ink dark:text-ink-dark">
            {name}
          </Text>
          {handle ? (
            <Text numberOfLines={1} className="shrink text-[15px] text-muted dark:text-muted-dark">
              @{handle}
            </Text>
          ) : null}
          <Text className="text-[15px] text-muted dark:text-muted-dark">· {relativeTime(post.createdAtMs, now)}</Text>
          <View className="flex-1" />
          {onMore ? (
            <Pressable accessibilityRole="button" accessibilityLabel="More options" onPress={onMore} hitSlop={8}>
              <Icon name="ellipsis-horizontal" size={18} color={palette.muted} />
            </Pressable>
          ) : null}
        </View>
        {audience ? (
          <View className="flex-row items-center gap-1">
            <Icon name="lock-closed" size={12} color={palette.muted} />
            <Text className="text-xs text-muted dark:text-muted-dark">{audience}</Text>
          </View>
        ) : null}
        {post.text ? <PostText text={post.text} className="text-[15px] leading-5 text-ink dark:text-ink-dark" /> : null}
        {post.media.length ? <MediaGrid media={post.media} onPress={onMediaPress} /> : null}
        {onReply || (LIKES_ENABLED && onLike) ? (
          <View className="flex-row items-center gap-10 pt-1">
            <Action icon="chatbubble-outline" label={`Reply, ${post.replyCount} replies`} count={post.replyCount} onPress={onReply} />
            {LIKES_ENABLED ? (
              <Action icon={post.likedByMe ? 'heart' : 'heart-outline'} label={post.likedByMe ? 'Unlike' : 'Like'} count={post.likeCount} active={post.likedByMe} onPress={onLike} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function ProgressFill({ fraction }: { fraction: number }) {
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(fraction, { duration: 250 });
  }, [fraction, width]);
  const animated = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <Animated.View style={animated}>
      <View className="h-1 w-full bg-primary dark:bg-primary-dark" />
    </Animated.View>
  );
}

/** The inline "uploading…" card for a post still being uploaded. */
export function OutboxCard({ item, onRetry, onDismiss }: { item: OutboxItem; onRetry: () => void; onDismiss: () => void }) {
  const pct = Math.round(item.progress * 100);
  return (
    <View className="gap-2 border-b border-border bg-surface-raised px-4 py-3 dark:border-border-dark dark:bg-surface-raised-dark">
      <Text numberOfLines={2} className="text-base text-ink dark:text-ink-dark">
        {item.draft.text || `${item.draft.media.length} ${item.draft.media.length === 1 ? 'attachment' : 'attachments'}`}
      </Text>
      {item.status === 'failed' ? (
        <View className="flex-row items-center gap-4">
          <Text className="flex-1 text-sm text-danger dark:text-danger-dark">{item.error ?? 'Upload failed'}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text className="font-bold text-primary dark:text-primary-dark">Retry</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onDismiss}>
            <Text className="text-muted dark:text-muted-dark">Discard</Text>
          </Pressable>
        </View>
      ) : (
        <View className="gap-1">
          <Text className="text-sm text-muted dark:text-muted-dark">Uploading… {pct}%</Text>
          <View className="h-1 overflow-hidden rounded-full bg-border dark:bg-border-dark">
            <ProgressFill fraction={item.progress} />
          </View>
        </View>
      )}
    </View>
  );
}
