import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { putPost } from '@/lib/feed-store';
import type { UserReply } from '@/lib/thread';
import { relativeTime } from '@/lib/time';
import { usePalette } from '@/theme/use-palette';

/**
 * One of someone's replies on their profile (X style): the reply, "Replying to @them", and a preview of the post it
 * answers. Only posts I can see are ever listed (the server checks). Tapping opens the thread at the reply.
 */
export function ReplyCard({ item, now }: { item: UserReply; now: number }) {
  const palette = usePalette();
  const { reply, post } = item;
  const open = () => {
    putPost(post);
    router.push({ pathname: '/post/[id]', params: { id: post.postId, reply: reply.replyId } });
  };
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens the reply" onPress={open} className="flex-row gap-3 border-b border-border px-4 py-3 active:opacity-70 dark:border-border-dark">
      <Avatar size="sm" id={reply.authorId} name={reply.authorName} uri={reply.authorAvatar} />
      <View className="flex-1 gap-1">
        <Text numberOfLines={1} className="text-sm text-muted dark:text-muted-dark">
          <Text className="font-bold text-ink dark:text-ink-dark">{reply.authorName}</Text> @{reply.authorHandle} · {relativeTime(reply.createdAtMs, now)}
        </Text>
        <Text className="text-sm text-muted dark:text-muted-dark">
          Replying to <Text className="text-primary dark:text-primary-dark">@{post.authorHandle}</Text>
        </Text>
        <Text className="text-base text-ink dark:text-ink-dark">{reply.text}</Text>
        <View className="mt-1 gap-0.5 rounded-xl border border-border px-3 py-2 dark:border-border-dark">
          <Text numberOfLines={1} className="text-sm text-muted dark:text-muted-dark">
            <Text className="font-bold text-ink dark:text-ink-dark">{post.authorName}</Text> · {relativeTime(post.createdAtMs, now)}
          </Text>
          <Text numberOfLines={2} className="text-sm text-ink dark:text-ink-dark">
            {post.text || (post.media.length ? (post.media[0].type === 'video' ? 'Video' : 'Photo') : '')}
          </Text>
        </View>
        {reply.likeCount ? (
          <View className="mt-1 flex-row items-center gap-1">
            <Icon name={reply.likedByMe ? 'heart' : 'heart-outline'} size={14} color={reply.likedByMe ? palette.danger : palette.muted} />
            <Text className="text-xs text-muted dark:text-muted-dark">{reply.likeCount}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
