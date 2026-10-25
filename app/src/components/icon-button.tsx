import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

type Props = {
  /** Required: every icon-only button needs a screen-reader label (PLAN.md 2A polish). */
  accessibilityLabel: string;
  onPress?: () => void;
  children: ReactNode;
  className?: string;
};

export function IconButton({ accessibilityLabel, onPress, children, className = '' }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      className={`items-center justify-center rounded-full p-2 active:opacity-60 ${className}`}>
      {children}
    </Pressable>
  );
}
