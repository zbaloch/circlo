import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { useIntegrityWarning } from '@/lib/device-integrity';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';

/** Home banner on a rooted/jailbroken phone; warns only and can be dismissed (Settings keeps showing it). */
export function IntegrityBanner() {
  const { message, dismissed, dismiss } = useIntegrityWarning();
  const palette = usePalette();
  if (!message || dismissed) return null;
  return (
    <View accessibilityRole="alert" className="mx-4 my-2 flex-row gap-3 rounded-2xl border border-danger p-3 dark:border-danger-dark">
      <Ionicons name="warning-outline" size={20} color={palette.danger} />
      <Text className="flex-1 text-sm text-ink dark:text-ink-dark">{message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss warning" onPress={dismiss} hitSlop={8}>
        <Ionicons name="close" size={20} color={palette.muted} />
      </Pressable>
    </View>
  );
}
