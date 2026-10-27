import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import type { AddressBook } from '@/lib/addressbook';
import { audienceSize, labelOf, listedCircles } from '@/lib/circles';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';

type Props = {
  visible: boolean;
  book: AddressBook;
  selected: number;
  onSelect: (circle: number) => void;
  onClose: () => void;
};

export function audienceLine(book: AddressBook, circle: number): string {
  const n = audienceSize(book, circle);
  return circle === 1 ? 'Only you' : `Visible to this circle and closer · ${n} ${n === 1 ? 'person' : 'people'}`;
}

/** Bottom sheet listing my circles by my own labels (PLAN.md 2A). Author-only: readers never see any of this. */
export function AudienceSheet({ visible, book, selected, onSelect, onClose }: Props) {
  const palette = usePalette();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[70%] rounded-t-3xl bg-surface pb-6 dark:bg-surface-dark">
        <View className="items-center py-3">
          <View className="h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
        </View>
        <Text className="px-5 pb-2 text-xl font-bold text-ink dark:text-ink-dark">Who can see this?</Text>
        <ScrollView>
          {listedCircles(book).map((c) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ selected: c === selected }}
              onPress={() => {
                onSelect(c);
                onClose();
              }}
              className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
              <View className="h-9 w-9 items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark">
                <Text className="font-bold text-primary dark:text-primary-dark">{c}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-ink dark:text-ink-dark">{labelOf(book, c)}</Text>
                <Text className="text-sm text-muted dark:text-muted-dark">{audienceLine(book, c)}</Text>
              </View>
              {c === selected ? <Ionicons name="checkmark-circle" size={22} color={palette.primary} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
