import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, type ComponentProps } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Avatar } from '@/components/avatar';
import { MediaGrid } from '@/components/encrypted-media';
import type { OutboxItem } from '@/lib/outbox';
import type { FeedPost } from '@/lib/posts';
import { relativeTime } from '@/lib/time';
import { linkParts } from '@/lib/view-logic';
import { usePalette } from '@/theme/use-palette';

type Props = {
  post: FeedPost;
  name: string;
  handle?: string;
  /** Author-only audience label for my own posts, e.g. "Closest friends+". Never passed for other people's posts. */
  audience?: string;
  /** Opens the thread. Omitted inside the thread itself. */
  onOpen?: () => void;
  onReply?: () => void;
  onLike?: () => void;
  onMore?: () => void;
  onMediaPress?: (index: number) => void;
};

function Action({ icon, label, count, active, onPress }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; count?: number; active?: boolean; onPress?: () => void }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} hitSlop={8} className="flex-row items-center gap-1">
      <Ionicons name={icon} size={18} color={active ? palette.danger : palette.muted} />
      {count ? <Text className={active ? 'text-sm text-danger dark:text-danger-dark' : 'text-sm text-muted dark:text-muted-dark'}>{count}</Text> : null}
    </Pressable>
  );
}

/** Post card (PLAN.md 2A). No repost action, deliberately: resharing would leak a post beyond its circle. */
export function PostCard({ post, name, handle, audience, onOpen, onReply, onLike, onMore, onMediaPress }: Props) {
  const palette = usePalette();
  return (
    <Pressable onPress={onOpen} disabled={!onOpen} className="flex-row gap-3 border-b border-border px-4 py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
      <Avatar name={name} />
      <View className="flex-1 gap-2">
        <View className="flex-row items-center gap-1">
          <Text numberOfLines={1} className="shrink text-base font-bold text-ink dark:text-ink-dark">
            {name}
          </Text>
          {handle ? (
            <Text numberOfLines={1} className="shrink text-base text-muted dark:text-muted-dark">
              @{handle}
            </Text>
          ) : null}
          <Text className="text-base text-muted dark:text-muted-dark">· {relativeTime(post.createdAtMs)}</Text>
          <View className="flex-1" />
          {onMore ? (
            <Pressable accessibilityRole="button" accessibilityLabel="More options" onPress={onMore} hitSlop={8}>
              <Ionicons name="ellipsis-horizontal" size={18} color={palette.muted} />
            </Pressable>
          ) : null}
        </View>
        {audience ? (
          <View className="flex-row items-center gap-1">
            <Ionicons name="lock-closed" size={12} color={palette.muted} />
            <Text className="text-xs text-muted dark:text-muted-dark">{audience}</Text>
          </View>
        ) : null}
        {post.text ? (
          <Text className="text-base text-ink dark:text-ink-dark">
            {linkParts(post.text).map((part, i) =>
              part.url ? (
                <Text key={i} accessibilityRole="link" onPress={() => Linking.openURL(part.url!)} className="text-primary dark:text-primary-dark">
                  {part.text}
                </Text>
              ) : (
                part.text
              ),
            )}
          </Text>
        ) : null}
        {post.media.length ? <MediaGrid media={post.media} onPress={onMediaPress} /> : null}
        {onReply || onLike ? (
          <View className="flex-row items-center gap-10 pt-1">
            <Action icon="chatbubble-outline" label={`Reply, ${post.replyCount} replies`} count={post.replyCount} onPress={onReply} />
            <Action icon={post.likedByMe ? 'heart' : 'heart-outline'} label={post.likedByMe ? 'Unlike' : 'Like'} count={post.likeCount} active={post.likedByMe} onPress={onLike} />
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
  return <Animated.View className="h-1 bg-primary dark:bg-primary-dark" style={animated} />;
}

/** The inline "uploading…" card for a post still being encrypted and uploaded. */
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
          <Text className="text-sm text-muted dark:text-muted-dark">Encrypting and uploading… {pct}%</Text>
          <View className="h-1 overflow-hidden rounded-full bg-border dark:bg-border-dark">
            <ProgressFill fraction={item.progress} />
          </View>
        </View>
      )}
    </View>
  );
}
