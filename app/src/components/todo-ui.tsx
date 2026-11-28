import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/form';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import type { Todo, TodoList } from '@/lib/todos';
import { usePalette } from '@/theme/use-palette';

/**
 * One to-do, like a line on paper: a round box to tick and the title, crossed through once ticked. Under it, quietly,
 * a mark when it has notes, and its list in All. Tapping opens it; in a list, a long press drags it.
 */
export function TodoRow({ todo, listName, checked, onToggle, onOpen, onLongPress }: {
  todo: Todo;
  listName?: string;
  checked: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  onLongPress?: () => void;
}) {
  const palette = usePalette();
  const notes = todo.noteCount > 0;
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
        accessibilityLabel={`${todo.title}${notes ? ', has notes' : ''}`}
        accessibilityHint={onOpen ? 'Opens the to-do and its notes' : undefined}
        disabled={!onOpen && !onLongPress}
        onPress={onOpen}
        onLongPress={onLongPress}
        delayLongPress={250}
        className="flex-1 gap-0.5">
        <Text className={`text-[16px] leading-snug ${checked ? 'text-muted line-through dark:text-muted-dark' : 'text-ink dark:text-ink-dark'}`}>{todo.title}</Text>
        {notes || listName ? (
          <View className="flex-row items-center gap-2">
            {notes ? <Icon name="document-text-outline" size={13} color={palette.muted} accessibilityLabel="Has notes" /> : null}
            {listName ? <Text className="text-sm text-muted dark:text-muted-dark">{listName}</Text> : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

/** Quick add, pinned at the bottom: type a to-do and press return; the field stays open for the next one. */
export function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => Promise<void> }) {
  const palette = usePalette();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const title = text.trim();
  const add = async () => {
    if (!title || busy) return;
    setBusy(true);
    try {
      await onAdd(title);
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="flex-row items-end gap-2 border-t border-border bg-surface px-3 py-2 dark:border-border-dark dark:bg-surface-dark">
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
 * What I'm looking at, above the to-dos: which list ("All ▾", or one, picked from a list) and a Completed toggle, as
 * in Feeds' source picker and Unread.
 */
export function TodoFilterBar({ listLabel, completed, onPickList, onCompleted }: {
  listLabel: string;
  completed: boolean;
  onPickList: () => void;
  onCompleted: (completed: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-2 border-b border-border px-4 py-2.5 dark:border-border-dark">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Showing ${listLabel}`}
        accessibilityHint="Choose all lists or one"
        onPress={onPickList}
        className="shrink flex-row items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
        <Text numberOfLines={1} className="shrink font-semibold text-ink dark:text-ink-dark">
          {listLabel}
        </Text>
        <Icon name="chevron-down" size={16} color={palette.ink} />
      </Pressable>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Completed"
        accessibilityState={{ checked: completed }}
        onPress={() => onCompleted(!completed)}
        className={`rounded-full border px-3.5 py-1.5 ${
          completed ? 'border-primary bg-primary dark:border-primary-dark dark:bg-primary-dark' : 'border-border active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark'
        }`}>
        <Text className={completed ? 'font-semibold text-on-primary dark:text-on-primary-dark' : 'text-ink dark:text-ink-dark'}>Completed</Text>
      </Pressable>
    </View>
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

/** A choice of chips (which list a to-do is in), the app's chip look. */
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
