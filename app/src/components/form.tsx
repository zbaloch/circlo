import type { ReactNode } from 'react';
import { Pressable, View, type TextInputProps } from 'react-native';

import { usePalette } from '@/theme/use-palette';
import { Text, TextInput } from '@/components/ui/text';
import { Spinner } from './ui/spinner';

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
        className="rounded-lg border border-border px-4 py-3 text-[15px] text-ink focus:border-primary dark:border-border-dark dark:text-ink-dark"
        {...input}
      />
      {hint ? <Text className="text-sm text-muted dark:text-muted-dark">{hint}</Text> : null}
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** primary: brand pill; outline: secondary; danger: destructive actions (red). */
  variant?: 'primary' | 'outline' | 'danger';
};

const BUTTON: Record<NonNullable<ButtonProps['variant']>, { box: string; text: string }> = {
  primary: { box: 'bg-primary active:bg-primary-pressed dark:bg-primary-dark', text: 'text-white' },
  outline: { box: 'border border-border active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark', text: 'text-ink dark:text-ink-dark' },
  danger: { box: 'bg-danger active:opacity-80 dark:bg-danger-dark', text: 'text-white' },
};

/** Pill button (X style), the same on iOS and Android. */
export function Button({ label, onPress, loading = false, disabled = false, variant = 'primary' }: ButtonProps) {
  const off = disabled || loading;
  const v = BUTTON[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      disabled={off}
      onPress={onPress}
      className={`min-h-[48px] items-center justify-center rounded-full px-5 ${v.box} ${off ? 'opacity-50' : ''}`}>
      {loading ? <Spinner tone={variant === 'outline' ? 'default' : 'onPrimary'} /> : <Text className={`text-[15px] font-bold ${v.text}`}>{label}</Text>}
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
