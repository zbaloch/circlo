import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';

import { usePalette } from '@/theme/use-palette';

type FieldProps = TextInputProps & { label: string; hint?: string };

export function TextField({ label, hint, ...input }: FieldProps) {
  const palette = usePalette();
  return (
    <View className="gap-1">
      <Text className="text-sm font-semibold text-ink dark:text-ink-dark">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={palette.muted}
        autoCapitalize="none"
        autoCorrect={false}
        className="rounded-xl border border-border px-4 py-3 text-base text-ink dark:border-border-dark dark:text-ink-dark"
        {...input}
      />
      {hint ? <Text className="text-sm text-muted dark:text-muted-dark">{hint}</Text> : null}
    </View>
  );
}

type ButtonProps = { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'outline' };

export function Button({ label, onPress, loading = false, disabled = false, variant = 'primary' }: ButtonProps) {
  const off = disabled || loading;
  const base = 'items-center rounded-full py-4';
  const style =
    variant === 'primary'
      ? `${base} bg-primary active:bg-primary-pressed dark:bg-primary-dark ${off ? 'opacity-50' : ''}`
      : `${base} border border-primary active:opacity-60 dark:border-primary-dark ${off ? 'opacity-50' : ''}`;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy: loading }} disabled={off} onPress={onPress} className={style}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#FFFFFF' : undefined} />
      ) : (
        <Text className={`text-base font-bold ${variant === 'primary' ? 'text-white' : 'text-primary dark:text-primary-dark'}`}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" className="text-base text-danger dark:text-danger-dark">
      {children}
    </Text>
  );
}

export function Title({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <View className="gap-2">
      <Text className="text-3xl font-bold text-ink dark:text-ink-dark">{children}</Text>
      {subtitle ? <Text className="text-base text-muted dark:text-muted-dark">{subtitle}</Text> : null}
    </View>
  );
}
