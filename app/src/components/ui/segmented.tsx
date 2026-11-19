import { Pressable, View } from 'react-native';

import { Text } from './text';

type Option<T extends string> = { value: T; label: string };

/** A row of options with one chosen, like Bluesky's Appearance settings: the chosen one sits raised in the track. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      className="flex-row gap-1 rounded-2xl border border-border bg-surface-raised p-1 dark:border-border-dark dark:bg-surface-raised-dark">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            className={`flex-1 items-center rounded-xl py-2.5 ${on ? 'bg-surface dark:bg-surface-dark' : 'active:opacity-70'}`}>
            <Text className={`text-[15px] ${on ? 'font-bold text-ink dark:text-ink-dark' : 'font-semibold text-muted dark:text-muted-dark'}`}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
