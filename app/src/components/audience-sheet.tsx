import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { CircleBadge } from './circle-badge';
import { CLOSE_FRIENDS, type AddressBook } from '@/lib/addressbook';
import { audienceSize, labelOf, listedCircles, ONLY_ME } from '@/lib/circles';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';

type Props = {
  visible: boolean;
  book: AddressBook;
  selected: number;
  onSelect: (circle: number) => void;
  onClose: () => void;
  /** Defaults are for choosing a post's audience; placing a friend passes its own. */
  title?: string;
  circles?: number[];
  describe?: (circle: number) => string;
};

export function audienceLine(book: AddressBook, circle: number): string {
  const n = audienceSize(book, circle);
  const people = `${n} ${n === 1 ? 'person' : 'people'}`;
  if (circle === ONLY_ME) return 'Only you';
  if (circle === CLOSE_FRIENDS) return `Only your Close Friends · ${people}`;
  return `Visible to this circle and closer · ${people}`;
}

/** Bottom sheet listing my circles by my own labels (PLAN.md 2A). Author-only: readers never see any of this. */
export function AudienceSheet({
  visible,
  book,
  selected,
  onSelect,
  onClose,
  title = 'Who can see this?',
  circles = [...listedCircles(book), CLOSE_FRIENDS],
  describe = (c) => audienceLine(book, c),
}: Props) {
  const palette = usePalette();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[70%] rounded-t-3xl bg-surface pb-6 dark:bg-surface-dark">
        <View className="items-center py-3">
          <View className="h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
        </View>
        <Text className="px-5 pb-2 text-xl font-bold text-ink dark:text-ink-dark">{title}</Text>
        <ScrollView>
          {circles.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ selected: c === selected }}
              onPress={() => {
                onSelect(c);
                onClose();
              }}
              className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
              <CircleBadge book={book} circle={c} />
              <View className="flex-1">
                <Text className="text-base font-semibold text-ink dark:text-ink-dark">{labelOf(book, c)}</Text>
                <Text className="text-sm text-muted dark:text-muted-dark">{describe(c)}</Text>
              </View>
              {c === selected ? <Ionicons name="checkmark-circle" size={22} color={palette.primary} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
