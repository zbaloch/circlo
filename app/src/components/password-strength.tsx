import { View } from 'react-native';

import type { PasswordCheck } from '@/lib/password-strength';
import { Text } from '@/components/ui/text';

const BARS = [1, 2, 3, 4];

/** Four bars and a line under a new-password field: what's wrong with it, or that it's good. */
export function PasswordStrength({ check, empty }: { check: PasswordCheck; empty: boolean }) {
  if (empty) return null;
  const filled = check.ok ? check.score : Math.min(check.score, 2);
  const tone = check.ok ? 'bg-primary dark:bg-primary-dark' : 'bg-danger dark:bg-danger-dark';
  const label = check.ok ? (check.score === 4 ? 'Strong password' : 'Good password') : check.problem;
  return (
    <View className="gap-1.5" accessible accessibilityLabel={label}>
      <View className="flex-row gap-1">
        {BARS.map((b) => (
          <View key={b} className={`h-1 flex-1 rounded-full ${b <= Math.max(filled, 1) ? tone : 'bg-border dark:bg-border-dark'}`} />
        ))}
      </View>
      {label ? (
        <Text className={`text-sm ${check.ok ? 'text-muted dark:text-muted-dark' : 'text-danger dark:text-danger-dark'}`}>{label}</Text>
      ) : null}
    </View>
  );
}
