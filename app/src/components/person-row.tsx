import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { usePalette } from '@/theme/use-palette';

/**
 * One person in a list, X followers-list style: photo, name, @handle and bio, with an optional button on the right.
 * Tapping the row opens their profile.
 */
export function PersonRow({ id, name, handle, bio, note, avatarUrl, onPress, action }: {
  id: string;
  name: string;
  handle?: string;
  bio?: string;
  /** A line of my own about them, such as the circles I put them in (only I see it). */
  note?: string;
  avatarUrl?: string | null;
  onPress: () => void;
  action?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, handle ? `@${handle}` : '', note ?? '', bio ?? ''].filter(Boolean).join(', ')}
      onPress={onPress}
      className="flex-row gap-3 py-3 active:opacity-60">
      <Avatar id={id} name={name} uri={avatarUrl} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Text numberOfLines={1} className="font-bold text-ink dark:text-ink-dark">{name}</Text>
            {handle ? <Text numberOfLines={1} className="text-muted dark:text-muted-dark">@{handle}</Text> : null}
          </View>
          {action}
        </View>
        {note ? (
          <View className="flex-row items-center gap-1">
            <Icon name="people-outline" size={14} color={palette.primary} />
            <Text numberOfLines={2} className="flex-1 text-sm font-semibold text-primary dark:text-primary-dark">{note}</Text>
          </View>
        ) : null}
        {bio ? <Text numberOfLines={3} className="text-ink dark:text-ink-dark">{bio}</Text> : null}
      </View>
    </Pressable>
  );
}

/** The small pill on a person row: filled for adding, outlined for removing (X's Follow / Following). */
export function RowButton({ label, accessibilityLabel, filled = false, busy = false, disabled = false, onPress }: {
  label: string;
  accessibilityLabel: string;
  filled?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      className={`min-h-[32px] items-center justify-center rounded-full px-4 active:opacity-60 ${
        filled ? 'bg-ink dark:bg-ink-dark' : 'border border-border dark:border-border-dark'
      } ${disabled ? 'opacity-50' : ''}`}>
      <Text className={`text-sm font-bold ${filled ? 'text-surface dark:text-surface-dark' : 'text-ink dark:text-ink-dark'}`}>
        {busy ? 'Updating…' : label}
      </Text>
    </Pressable>
  );
}
