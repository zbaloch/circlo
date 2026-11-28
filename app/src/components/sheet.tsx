import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Text } from '@/components/ui/text';

/**
 * A bottom sheet, the app's look: a handle, a title, its rows. Scrolls when long. It rises with the keyboard, so a
 * field in it (a list's name) stays above it: keyboard-controller follows the keyboard inside modals too.
 */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[75%] rounded-t-3xl bg-surface pb-8 pt-3 dark:bg-surface-dark">
        <View className="items-center pb-2">
          <View className="h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
        </View>
        <Text className="px-5 pb-2 text-base font-bold text-ink dark:text-ink-dark">{title}</Text>
        {children}
        <KeyboardSpacer />
      </View>
    </Modal>
  );
}

/** A choice of chips (a to-do's list, a person's rhythm), the app's chip look. */
export function ChoiceChips<T extends string>({ options, selected, onSelect, label }: {
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
  label: string;
}) {
  return (
    <View accessibilityLabel={label} className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === selected;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(o.value)}
            className={`rounded-full border px-3.5 py-1.5 ${
              on ? 'border-primary bg-primary dark:border-primary-dark dark:bg-primary-dark' : 'border-border active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark'
            }`}>
            <Text className={on ? 'font-semibold text-on-primary dark:text-on-primary-dark' : 'text-ink dark:text-ink-dark'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
