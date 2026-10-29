import { Icon, type IconName } from '@/components/ui/icon';
import { Pressable } from 'react-native';

import { usePalette } from '@/theme/use-palette';

type Props = {
  accessibilityLabel: string;
  icon?: IconName;
  onPress?: () => void;
};

/** Floating action button, bottom-right above the tab bar (compose / new message). */
export function Fab({ accessibilityLabel, icon = 'add', onPress }: Props) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark">
      <Icon name={icon} size={28} color={palette.onPrimary} />
    </Pressable>
  );
}
