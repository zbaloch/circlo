import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/form';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import {
  addDays,
  dayLabel,
  fullDate,
  monthOf,
  monthTitle,
  monthWeeks,
  nextWeek,
  shiftMonth,
  WEEKDAY_INITIALS,
  WHEN,
  type Todo,
  type TodoList,
  type When,
} from '@/lib/todos';
import { usePalette } from '@/theme/use-palette';

/**
 * One to-do, Things-calm: a round box to tick, the title, and a quiet line under it (its date, in soft red when
 * overdue; a repeat mark; a notes mark; its list in the date views). Tapping opens it; in a list, a long press drags it.
 */
export function TodoRow({ todo, today, listName, checked, onToggle, onOpen, onLongPress }: {
  todo: Todo;
  today: string;
  listName?: string;
  checked: boolean;
  onToggle: () => void;
  /** Left out for completed to-dos, which only untick. */
  onOpen?: () => void;
  onLongPress?: () => void;
}) {
  const palette = usePalette();
  const overdue = !!todo.dueDate && todo.dueDate < today && !checked;
  const date = todo.dueDate ? dayLabel(todo.dueDate, today) : null;
  const meta = date || todo.repeat || todo.notes || listName;
  return (
    <View className="flex-row items-start gap-3 bg-surface px-4 py-3 dark:bg-surface-dark">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={todo.title}
        accessibilityState={{ checked }}
        hitSlop={10}
        onPress={onToggle}
        className={`mt-0.5 h-6 w-6 items-center justify-center rounded-full border-2 ${
          checked ? 'border-primary bg-primary dark:border-primary-dark dark:bg-primary-dark' : 'border-muted dark:border-muted-dark'
        }`}>
        {checked ? <Icon name="checkmark" size={15} color={palette.onPrimary} /> : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${todo.title}${date ? `, ${overdue ? 'overdue, ' : ''}${date}` : ''}`}
        accessibilityHint={onOpen ? 'Opens the to-do' : undefined}
        disabled={!onOpen && !onLongPress}
        onPress={onOpen}
        onLongPress={onLongPress}
        delayLongPress={250}
        className="flex-1 gap-0.5">
        <Text className={`text-[16px] leading-snug ${checked ? 'text-muted line-through dark:text-muted-dark' : 'text-ink dark:text-ink-dark'}`}>{todo.title}</Text>
        {meta ? (
          <View className="flex-row flex-wrap items-center gap-x-2">
            {date ? <Text className={`text-sm ${overdue ? 'text-danger dark:text-danger-dark' : 'text-muted dark:text-muted-dark'}`}>{date}</Text> : null}
            {todo.repeat ? <Icon name="repeat-outline" size={13} color={palette.muted} accessibilityLabel="Repeats" /> : null}
            {todo.notes ? <Icon name="document-text-outline" size={13} color={palette.muted} accessibilityLabel="Has notes" /> : null}
            {listName ? <Text className="text-sm text-muted dark:text-muted-dark">{listName}</Text> : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

/**
 * Quick add, pinned at the bottom: type a to-do and press return (the field stays open for the next one). The
 * calendar button beside it gives it a date (Today, Tomorrow, Next week or a day on the calendar); the date shows as a
 * chip, tapped to take it off. With no date picked, the screen decides (today in Today, tomorrow in Upcoming).
 */
export function QuickAdd({ placeholder, today, onAdd }: {
  placeholder: string;
  today: string;
  onAdd: (todo: { title: string; dueDate: string | null }) => Promise<void>;
}) {
  const palette = usePalette();
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = text.trim();
  const add = async () => {
    if (!title || busy) return;
    setBusy(true);
    try {
      await onAdd({ title, dueDate });
      setText('');
      setDueDate(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-2 border-t border-border bg-surface px-3 py-2 dark:border-border-dark dark:bg-surface-dark">
      {dueDate ? (
        <View className="flex-row">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Due ${dayLabel(dueDate, today)}. Tap to take the date off`}
            onPress={() => setDueDate(null)}
            className="flex-row items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 dark:bg-primary-dark/20">
            <Icon name="calendar-outline" size={14} color={palette.primary} />
            <Text className="text-sm font-semibold text-primary dark:text-primary-dark">{dayLabel(dueDate, today)}</Text>
            <Icon name="close" size={14} color={palette.primary} />
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row items-end gap-2">
        <IconButton accessibilityLabel={dueDate ? `Date: ${dayLabel(dueDate, today)}` : 'Pick a date'} onPress={() => setPicking(true)}>
          <Icon name="calendar-outline" size={22} color={dueDate ? palette.primary : palette.muted} />
        </IconButton>
        <TextInput
          accessibilityLabel="New to-do"
          placeholder={placeholder}
          placeholderTextColor={palette.muted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => void add()}
          submitBehavior="submit"
          returnKeyType="done"
          maxLength={500}
          className="max-h-28 flex-1 rounded-2xl bg-surface-raised px-4 py-2 text-base text-ink dark:bg-surface-raised-dark dark:text-ink-dark"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add to-do"
          disabled={!title || busy}
          onPress={() => void add()}
          className={`h-10 w-10 items-center justify-center rounded-full bg-primary dark:bg-primary-dark ${!title || busy ? 'opacity-50' : ''}`}>
          <Icon name="arrow-up" size={20} color={palette.onPrimary} />
        </Pressable>
      </View>
      <DateSheet
        visible={picking}
        today={today}
        value={dueDate}
        onPick={(d) => {
          setDueDate(d);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

/** Today, Tomorrow, Next week, No date: the usual dates, one tap each. */
export function DateShortcuts({ today, value, onPick }: { today: string; value: string | null; onPick: (date: string | null) => void }) {
  const choices: { value: string; label: string; date: string | null }[] = [
    { value: 'today', label: 'Today', date: today },
    { value: 'tomorrow', label: 'Tomorrow', date: addDays(today, 1) },
    { value: 'nextweek', label: 'Next week', date: nextWeek(today) },
    { value: 'none', label: 'No date', date: null },
  ];
  const selected = choices.find((c) => c.date === value)?.value ?? null;
  return (
    <ChoiceChips
      label="Date"
      selected={selected}
      onSelect={(v) => onPick(choices.find((c) => c.value === v)!.date)}
      options={choices.map((c) => ({ value: c.value, label: c.label }))}
    />
  );
}

/**
 * A month to tap a day in, Monday first: today ringed, the picked day filled. ‹ › move a month; past days can be
 * picked too (for something already overdue).
 */
export function Calendar({ today, value, onPick }: { today: string; value: string | null; onPick: (date: string) => void }) {
  const palette = usePalette();
  const [month, setMonth] = useState(monthOf(value ?? today));
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <IconButton accessibilityLabel="Previous month" onPress={() => setMonth((m) => shiftMonth(m, -1))}>
          <Icon name="chevron-back" size={20} color={palette.ink} />
        </IconButton>
        <Text accessibilityRole="header" className="text-base font-semibold text-ink dark:text-ink-dark">
          {monthTitle(month, today)}
        </Text>
        <IconButton accessibilityLabel="Next month" onPress={() => setMonth((m) => shiftMonth(m, 1))}>
          <Icon name="chevron-forward" size={20} color={palette.ink} />
        </IconButton>
      </View>
      <View className="flex-row">
        {WEEKDAY_INITIALS.map((d, i) => (
          <Text key={i} importantForAccessibility="no" className="flex-1 text-center text-xs font-semibold text-muted dark:text-muted-dark">
            {d}
          </Text>
        ))}
      </View>
      {monthWeeks(month).map((week, w) => (
        <View key={w} className="flex-row">
          {week.map((day, i) =>
            day ? (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={fullDate(day)}
                accessibilityState={{ selected: day === value }}
                onPress={() => onPick(day)}
                className="flex-1 items-center py-0.5">
                <View
                  className={`h-9 w-9 items-center justify-center rounded-full ${
                    day === value ? 'bg-primary dark:bg-primary-dark' : day === today ? 'border border-primary dark:border-primary-dark' : ''
                  }`}>
                  <Text
                    className={`text-[15px] ${
                      day === value ? 'font-bold text-on-primary dark:text-on-primary-dark' : day < today ? 'text-muted dark:text-muted-dark' : 'text-ink dark:text-ink-dark'
                    }`}>
                    {Number(day.slice(8))}
                  </Text>
                </View>
              </Pressable>
            ) : (
              <View key={`${w}-${i}`} className="flex-1" />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

/** Picking a date for a new to-do: the shortcuts, then the calendar. */
function DateSheet({ visible, today, value, onPick, onClose }: {
  visible: boolean;
  today: string;
  value: string | null;
  onPick: (date: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title="Date" onClose={onClose}>
      {visible ? (
        <ScrollView contentContainerClassName="gap-4 px-5 pt-1">
          <DateShortcuts today={today} value={value} onPick={onPick} />
          <Calendar today={today} value={value} onPick={onPick} />
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

/**
 * A bottom sheet, the app's look: a handle, a title, its rows. Scrolls when long. It rises with the keyboard, so a
 * field in it (a list's name) stays above it: keyboard-controller follows the keyboard inside modals too.
 */
function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
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

/**
 * What I'm looking at, above the to-dos: which list ("All ▾", or one, picked from a list) and, beside it, one of
 * Today, Upcoming, No date or Completed (tap it again for everything). The two work together, as in Feeds.
 */
export function TodoFilterBar({ listLabel, when, onPickList, onWhen }: {
  listLabel: string;
  when: When | null;
  onPickList: () => void;
  onWhen: (when: When | null) => void;
}) {
  const palette = usePalette();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      className="grow-0 border-b border-border dark:border-border-dark"
      contentContainerClassName="items-center gap-2 px-4 py-2.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Showing ${listLabel}`}
        accessibilityHint="Choose all lists or one"
        onPress={onPickList}
        className="flex-row items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
        <Text numberOfLines={1} className="max-w-[160px] font-semibold text-ink dark:text-ink-dark">
          {listLabel}
        </Text>
        <Icon name="chevron-down" size={16} color={palette.ink} />
      </Pressable>
      {WHEN.map((w) => {
        const on = when === w.value;
        return (
          <Pressable
            key={w.value}
            accessibilityRole="button"
            accessibilityLabel={w.label}
            accessibilityState={{ selected: on }}
            accessibilityHint={on ? 'Shows everything again' : `Shows only ${w.label.toLowerCase()}`}
            onPress={() => onWhen(on ? null : w.value)}
            className={`rounded-full border px-3.5 py-1.5 ${
              on ? 'border-primary bg-primary dark:border-primary-dark dark:bg-primary-dark' : 'border-border active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark'
            }`}>
            <Text className={on ? 'font-semibold text-on-primary dark:text-on-primary-dark' : 'text-ink dark:text-ink-dark'}>{w.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** All, then each list, and New list; a check on the one shown. */
export function ListPicker({ visible, lists, selected, onSelect, onNewList, onClose }: {
  visible: boolean;
  lists: TodoList[];
  selected: string | null;
  onSelect: (listId: string | null) => void;
  onNewList: () => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const row = (key: string, listId: string | null, label: string) => {
    const on = listId === selected;
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        onPress={() => {
          onClose();
          onSelect(listId);
        }}
        className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
        <Icon name="list-todo" size={20} color={palette.muted} />
        <Text numberOfLines={1} className={`flex-1 text-base ${on ? 'font-bold' : ''} text-ink dark:text-ink-dark`}>
          {label}
        </Text>
        <View className="w-6 items-end">{on ? <Icon name="checkmark" size={20} color={palette.ink} /> : null}</View>
      </Pressable>
    );
  };
  return (
    <Sheet visible={visible} title="Show" onClose={onClose}>
      <ScrollView>
        {row('all', null, 'All')}
        {lists.map((l) => row(l.listId, l.listId, l.name))}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onClose();
            onNewList();
          }}
          className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
          <Icon name="add" size={20} color={palette.primary} />
          <Text className="text-base font-semibold text-primary dark:text-primary-dark">New list</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

/** Asks for a list's name (new, or renaming). */
export function ListNameSheet({ visible, title, initial, onSave, onClose }: {
  visible: boolean;
  title: string;
  initial: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {visible ? <ListNameForm initial={initial} onSave={onSave} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ListNameForm({ initial, onSave, onClose }: { initial: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const palette = usePalette();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(name.trim());
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-4 px-5 pt-1">
      <TextInput
        accessibilityLabel="List name"
        autoFocus
        placeholder="Groceries, Work, Trip…"
        placeholderTextColor={palette.muted}
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => void save()}
        maxLength={100}
        className="rounded-lg border border-border px-4 py-3 text-[15px] text-ink focus:border-primary dark:border-border-dark dark:text-ink-dark"
      />
      <Button label="Save" onPress={() => void save()} loading={busy} disabled={!name.trim()} />
    </View>
  );
}

/** A choice of chips (date shortcuts, repeat, list), the app's chip look. */
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
