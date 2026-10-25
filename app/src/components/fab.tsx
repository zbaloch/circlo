import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';

type Props = {
  accessibilityLabel: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  onPress?: () => void;
};

/** Floating action button, bottom-right above the tab bar (compose / new message). */
export function Fab({ accessibilityLabel, icon = 'add', onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg active:bg-primary-pressed dark:bg-primary-dark">
      <Ionicons name={icon} size={28} color="#FFFFFF" />
    </Pressable>
  );
}
