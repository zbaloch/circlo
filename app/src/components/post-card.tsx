import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Avatar } from '@/components/avatar';
import { MediaGrid } from '@/components/encrypted-media';
import type { OutboxItem } from '@/lib/outbox';
import type { FeedPost } from '@/lib/posts';
import { relativeTime } from '@/lib/time';
import { usePalette } from '@/theme/use-palette';

type Props = {
  post: FeedPost;
  name: string;
  handle?: string;
  /** Author-only audience label for my own posts, e.g. "Closest friends+". Never passed for other people's posts. */
  audience?: string;
  onDelete?: () => void;
};

/** Post card (PLAN.md 2A). Phase 8 adds the reply/like action row, links and the media viewer. */
export function PostCard({ post, name, handle, audience, onDelete }: Props) {
  const palette = usePalette();
  return (
    <View className="flex-row gap-3 border-b border-border px-4 py-3 dark:border-border-dark">
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
          {onDelete ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Delete post" onPress={onDelete} hitSlop={8}>
              <Ionicons name="trash-outline" size={18} color={palette.muted} />
            </Pressable>
          ) : null}
        </View>
        {audience ? (
          <View className="flex-row items-center gap-1">
            <Ionicons name="lock-closed" size={12} color={palette.muted} />
            <Text className="text-xs text-muted dark:text-muted-dark">{audience}</Text>
          </View>
        ) : null}
        {post.text ? <Text className="text-base text-ink dark:text-ink-dark">{post.text}</Text> : null}
        {post.media.length ? <MediaGrid media={post.media} /> : null}
      </View>
    </View>
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
