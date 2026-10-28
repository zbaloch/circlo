import { Icon } from '@/components/ui/icon';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AudienceSheet } from './audience-sheet';
import { CircleBadge } from './circle-badge';
import { Text } from '@/components/ui/text';
import type { AddressBook } from '@/lib/addressbook';
import { labelOf, listedCircles, MAX_CIRCLE, membersOf } from '@/lib/circles';
import { usePalette } from '@/theme/use-palette';

/** Chain circles a friend can be placed in: everything listed except Only me. Close Friends is a separate toggle. */
export function friendCircles(book: AddressBook): number[] {
  return listedCircles(book).filter((n) => n >= 2);
}

/** What placing someone in `n` means, for the circle picker sheet. */
export function placementLine(book: AddressBook, n: number): string {
  const here = membersOf(book, n).length;
  return n === MAX_CIRCLE ? `${here} here · the widest circle` : `${here} ${here === 1 ? 'person' : 'people'} here`;
}

/** Picker sheet for placing a friend in a circle (author-only; the friend is never told). */
export function CirclePickerSheet(props: {
  visible: boolean;
  book: AddressBook;
  selected: number;
  onSelect: (n: number) => void;
  onClose: () => void;
  title?: string;
}) {
  return (
    <AudienceSheet
      {...props}
      title={props.title ?? 'Add to which circle?'}
      circles={friendCircles(props.book)}
      describe={(n) => placementLine(props.book, n)}
    />
  );
}

/** A tappable "Add to circle" row that opens the picker sheet. */
export function CircleChoice({ book, value, onChange, label = 'Add to circle' }: {
  book: AddressBook;
  value: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${labelOf(book, value)}. Change`}
        onPress={() => setOpen(true)}
        className="flex-row items-center gap-3 rounded-xl bg-surface-raised px-3 py-2.5 active:opacity-70 dark:bg-surface-raised-dark">
        <CircleBadge book={book} circle={value} small />
        <View className="flex-1">
          <Text className="text-xs text-muted dark:text-muted-dark">{label} · only you see this</Text>
          <Text className="font-semibold text-ink dark:text-ink-dark">{labelOf(book, value)}</Text>
        </View>
        <Icon name="chevron-down" size={18} color={palette.muted} />
      </Pressable>
      <CirclePickerSheet visible={open} book={book} selected={value} onSelect={onChange} onClose={() => setOpen(false)} />
    </>
  );
}
