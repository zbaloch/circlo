import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/form';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import { dayLabel, parseQuickAdd, quickAddLabel, sameView, type QuickAdd as Parsed, type Todo, type TodoList, type TodoView } from '@/lib/todos';
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
 * Quick add, pinned at the bottom: type a to-do with its date in words ("Call mum tomorrow", "Pay rent every month");
 * a chip shows what will be set, and tapping its × keeps the words as they are. Return adds it and leaves the field
 * open for the next one.
 */
export function QuickAdd({ placeholder, today, onAdd }: { placeholder: string; today: string; onAdd: (q: Parsed) => Promise<void> }) {
  const palette = usePalette();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseQuickAdd(text, today, ignore);
  const chip = parsed.phrase ? quickAddLabel(parsed, today) : null;
  const add = async () => {
    if (!parsed.title || busy) return;
    setBusy(true);
    try {
      await onAdd(parsed);
      setText('');
      setIgnore(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-2 border-t border-border bg-surface px-3 py-2 dark:border-border-dark dark:bg-surface-dark">
      {chip ? (
        <View className="flex-row">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${chip}. Tap to keep the words “${parsed.phrase}” in the title instead`}
            onPress={() => setIgnore(parsed.phrase)}
            className="flex-row items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 dark:bg-primary-dark/20">
            <Icon name={parsed.repeat ? 'repeat-outline' : 'time-outline'} size={14} color={palette.primary} />
            <Text className="text-sm font-semibold text-primary dark:text-primary-dark">{chip}</Text>
            <Icon name="close" size={14} color={palette.primary} />
          </Pressable>
        </View>
      ) : null}
      <View className="flex-row items-end gap-2">
        <TextInput
          accessibilityLabel="New to-do"
          placeholder={placeholder}
          placeholderTextColor={palette.muted}
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (ignore && !t.toLowerCase().includes(ignore.toLowerCase())) setIgnore(null);
          }}
          onSubmitEditing={() => void add()}
          submitBehavior="submit"
          returnKeyType="done"
          maxLength={500}
          className="max-h-28 flex-1 rounded-2xl bg-surface-raised px-4 py-2 text-base text-ink dark:bg-surface-raised-dark dark:text-ink-dark"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add to-do"
          disabled={!parsed.title || busy}
          onPress={() => void add()}
          className={`h-10 w-10 items-center justify-center rounded-full bg-primary dark:bg-primary-dark ${!parsed.title || busy ? 'opacity-50' : ''}`}>
          <Icon name="arrow-up" size={20} color={palette.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

/** A bottom sheet, the app's look: a handle, a title, its rows. Scrolls when long. */
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
      </View>
    </Modal>
  );
}

/** Where to look: Today, Upcoming, No date, then each list, and New list. A check on the one shown. */
export function ViewPicker({ visible, lists, selected, onSelect, onNewList, onClose }: {
  visible: boolean;
  lists: TodoList[];
  selected: TodoView;
  onSelect: (view: TodoView) => void;
  onNewList: () => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const row = (key: string, view: TodoView, label: string, icon: Parameters<typeof Icon>[0]['name']) => {
    const on = sameView(view, selected);
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        onPress={() => {
          onClose();
          onSelect(view);
        }}
        className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
        <Icon name={icon} size={20} color={palette.muted} />
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
        {row('today', { kind: 'today' }, 'Today', 'star')}
        {row('upcoming', { kind: 'upcoming' }, 'Upcoming', 'time-outline')}
        {row('nodate', { kind: 'nodate' }, 'No date', 'layers-outline')}
        <Text className="px-5 pb-1 pt-4 text-sm font-semibold text-muted dark:text-muted-dark">Lists</Text>
        {lists.map((l) => row(l.listId, { kind: 'list', listId: l.listId }, l.name, 'checkbox-outline'))}
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
