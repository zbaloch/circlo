import { Icon } from '@/components/ui/icon';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ChoiceRow, Sheet } from './audience-sheet';
import { AudienceBadge, CircleBadge } from './circle-badge';
import { Button } from '@/components/form';
import { Text } from '@/components/ui/text';
import type { AddressBook } from '@/lib/addressbook';
import { audienceLabel, circleDefs, membersOf, TO_EVERYONE } from '@/lib/circles';
import { usePalette } from '@/theme/use-palette';

/**
 * Where a friend is: always Everyone (everyone I'm connected with is in it), plus the circles I picked:
 * "Everyone" or "Everyone, Family +1".
 */
export function circlesLine(book: Pick<AddressBook, 'circleDefs'>, ids: number[]): string {
  return ids.length ? `Everyone, ${audienceLabel(book, { kind: 'circles', ids })}` : 'Everyone';
}

/** The first row of every circle picker for a person: Everyone, ticked and locked. */
export function EveryoneRow({ book }: { book: Pick<AddressBook, 'circleDefs'> }) {
  return (
    <ChoiceRow
      multi
      locked
      checked
      badge={<AudienceBadge book={book} audience={TO_EVERYONE} />}
      title="Everyone"
      line="Always · everyone you’re connected with"
    />
  );
}

/** How many are in a circle, for the picker. */
export function memberLine(book: AddressBook, id: number): string {
  const n = membersOf(book, id).length;
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/** Picker sheet for a friend's circles, any number of them (author-only; the friend is never told). */
export function CirclePickerSheet({ visible, title = 'Their circles', ...rest }: {
  visible: boolean;
  book: AddressBook;
  selected: number[];
  onDone: (ids: number[]) => void;
  onClose: () => void;
  title?: string;
  confirmLabel?: string;
  /** Who's being added, to say in plain words what they'll see. */
  person?: string;
}) {
  // The body mounts each time the sheet opens, so it starts from the current choice.
  return (
    <Sheet visible={visible} onClose={rest.onClose} title={title}>
      <CirclePicker {...rest} />
    </Sheet>
  );
}

function CirclePicker({ book, selected, onDone, onClose, confirmLabel = 'Done', person }: {
  book: AddressBook;
  selected: number[];
  onDone: (ids: number[]) => void;
  onClose: () => void;
  confirmLabel?: string;
  person?: string;
}) {
  const [ids, setIds] = useState<number[]>(selected);
  const toggle = (id: number) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].sort((a, b) => a - b)));
  return (
    <>
      <Text className="px-5 pb-2 text-sm text-muted dark:text-muted-dark">
        {person
          ? `${person} will see your Everyone posts and your posts to the circles you tick, nothing else. They’re never told which circles they’re in.`
          : 'Everyone you connect with is added to Everyone and sees your Everyone posts. Add them to more circles if you like. Only you see this.'}
      </Text>
      <ScrollView>
        <EveryoneRow book={book} />
        <Text className="px-5 pb-1 pt-3 text-sm font-bold uppercase text-muted dark:text-muted-dark">Also add to</Text>
        {circleDefs(book).map((c) => (
          <ChoiceRow
            key={c.id}
            multi
            badge={<CircleBadge book={book} id={c.id} />}
            title={c.name}
            line={memberLine(book, c.id)}
            checked={ids.includes(c.id)}
            onPress={() => toggle(c.id)}
          />
        ))}
      </ScrollView>
      <View className="px-5 pt-3">
        <Button
          label={confirmLabel}
          onPress={() => {
            onDone(ids);
            onClose();
          }}
        />
      </View>
    </>
  );
}

/** A tappable "Circles" row that opens the picker sheet. Everyone is always included; more circles are optional. */
export function CircleChoice({ book, value, onChange, label = 'Add to circles' }: {
  book: AddressBook;
  value: number[];
  onChange: (ids: number[]) => void;
  label?: string;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const line = circlesLine(book, value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${line}. Change`}
        onPress={() => setOpen(true)}
        className="flex-row items-center gap-3 rounded-xl bg-surface-raised px-3 py-2.5 active:opacity-70 dark:bg-surface-raised-dark">
        <AudienceBadge book={book} audience={value.length ? { kind: 'circles', ids: value } : { kind: 'everyone' }} small />
        <View className="flex-1">
          <Text className="text-xs text-muted dark:text-muted-dark">{label} · only you see this</Text>
          <Text className="font-semibold text-ink dark:text-ink-dark">{line}</Text>
        </View>
        <Icon name="chevron-down" size={18} color={palette.muted} />
      </Pressable>
      <CirclePickerSheet visible={open} book={book} selected={value} onDone={onChange} onClose={() => setOpen(false)} title={label} />
    </>
  );
}
