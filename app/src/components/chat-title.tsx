import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { openProfile } from '@/components/post-actions';
import { Text } from '@/components/ui/text';
import { memberName, type Conversation } from '@/lib/messaging';
import { chatTitle } from '@/lib/view-logic';

/**
 * A chat's title bar: the other person's photo and name, tapping through to their profile (owner request 2026-11-08).
 * A group shows its initial and name, and tapping it shows the people in the chat.
 */
export function ChatTitle({ conv, account, onGroup }: { conv: Conversation; account: { userId: string }; onGroup: () => void }) {
  const names = conv.members.map((u) => memberName(conv, u, account));
  const title = conv.name || chatTitle(names);
  const one = conv.members.length === 1 ? conv.members[0] : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={one ? `${title}’s profile` : `People in ${title}`}
      onPress={() => (one ? openProfile(account, one) : onGroup())}
      hitSlop={6}
      className="max-w-[240px] flex-row items-center gap-2 active:opacity-60">
      <Avatar size="sm" id={one ?? conv.groupId} name={title} uri={one ? conv.people[one]?.avatarUrl : undefined} />
      <View className="shrink">
        <Text numberOfLines={1} className="text-base font-bold text-ink dark:text-ink-dark">
          {title}
        </Text>
      </View>
    </Pressable>
  );
}
