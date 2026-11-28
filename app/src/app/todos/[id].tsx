import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ContentText } from '@/components/content-text';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Screen } from '@/components/screen';
import { Calendar, ChoiceChips, DateShortcuts } from '@/components/todo-ui';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text, TextInput } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { showToast } from '@/lib/toast';
import { dayLabel, todayIso, type Repeat, type Todo, type TodoFields } from '@/lib/todos';
import { deleteTodoNow, refreshTodos, saveTodoNow, useTodos } from '@/lib/todos-store';
import { useNow } from '@/lib/use-now';
import { usePalette } from '@/theme/use-palette';

/** How long after the last change a to-do saves itself (and when I leave the screen). */
export const SAVE_AFTER_MS = 600;

type Draft = { title: string; notes: string; dueDate: string | null; repeat: Repeat | null; listId: string };

function draftOf(t: Todo): Draft {
  return { title: t.title, notes: t.notes ?? '', dueDate: t.dueDate, repeat: (t.repeat as Repeat | null) ?? null, listId: t.listId };
}

function fieldsOf(d: Draft): TodoFields {
  return { title: d.title.trim(), notes: d.notes.trim() ? d.notes : null, dueDate: d.dueDate, repeat: d.dueDate ? d.repeat : null, listId: d.listId };
}

/**
 * One to-do, to change: its title, notes (links tappable), date (shortcuts, or a day on the calendar), repeat and list.
 * There's no Save button: it saves itself a moment after each change, and when I leave.
 */
export default function TodoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { todos, loaded } = useTodos();
  const todo = todos.find((t) => t.todoId === id);

  useEffect(() => {
    if (!loaded) refreshTodos().catch(() => undefined);
  }, [loaded]);

  if (!todo) {
    return (
      <Screen>
        {loaded ? (
          <EmptyState icon="list-todo" title="Not here any more" body="This to-do was ticked or deleted." />
        ) : (
          <Spinner className="flex-1 py-10" />
        )}
      </Screen>
    );
  }
  return <Editor key={todo.todoId} todo={todo} />;
}

function Editor({ todo }: { todo: Todo }) {
  const navigation = useNavigation();
  const palette = usePalette();
  const now = useNow();
  const today = todayIso(new Date(now));
  const { lists } = useTodos();
  const [draft, setDraft] = useState<Draft>(() => draftOf(todo));
  const [editingNotes, setEditingNotes] = useState(!todo.notes);
  const saved = useRef(JSON.stringify(fieldsOf(draftOf(todo))));
  // Once deleted, nothing more is saved (the screen closes after it).
  const deleted = useRef(false);
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);

  // Saves itself a moment after a change, and on the way out.
  const save = useRef(async (d: Draft) => {
    const fields = fieldsOf(d);
    const key = JSON.stringify(fields);
    if (deleted.current || !fields.title || key === saved.current) return;
    saved.current = key;
    await saveTodoNow(todo.todoId, fields).catch(() => showToast('Couldn’t save the to-do. Try again.'));
  });
  useEffect(() => {
    const timer = setTimeout(() => void save.current(draft), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    const flush = save.current;
    return () => void flush(latest.current);
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton
          accessibilityLabel="Delete to-do"
          className="mr-2"
          onPress={() =>
            showAlert('Delete this to-do?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  deleted.current = true;
                  router.back();
                  deleteTodoNow(todo.todoId).catch(() => showToast('Couldn’t delete it. Try again.'));
                },
              },
            ])
          }>
          <Icon name="trash-outline" size={22} color={palette.ink} />
        </IconButton>
      ),
    });
  }, [navigation, palette.ink, todo.todoId]);

  const change = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-6 px-5 pb-12 pt-4" keyboardShouldPersistTaps="handled">
        <TextInput
          accessibilityLabel="Title"
          value={draft.title}
          onChangeText={(title) => change({ title })}
          multiline
          maxLength={500}
          placeholder="To-do"
          placeholderTextColor={palette.muted}
          className="text-2xl font-bold text-ink dark:text-ink-dark"
        />

        <View className="gap-2">
          <Text className="text-sm font-semibold text-muted dark:text-muted-dark">Notes</Text>
          {editingNotes ? (
            <TextInput
              accessibilityLabel="Notes"
              value={draft.notes}
              onChangeText={(notes) => change({ notes })}
              onBlur={() => draft.notes.trim() && setEditingNotes(false)}
              autoFocus={!!todo.notes}
              multiline
              maxLength={10_000}
              placeholder="Add notes"
              placeholderTextColor={palette.muted}
              className="min-h-[88px] rounded-2xl bg-surface-raised px-4 py-3 text-base text-ink dark:bg-surface-raised-dark dark:text-ink-dark"
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit notes"
              onPress={() => setEditingNotes(true)}
              className="min-h-[88px] rounded-2xl bg-surface-raised px-4 py-3 dark:bg-surface-raised-dark">
              <ContentText text={draft.notes} className="text-base leading-6 text-ink dark:text-ink-dark" />
            </Pressable>
          )}
        </View>

        <View className="gap-3">
          <Text className="text-sm font-semibold text-muted dark:text-muted-dark">
            Date{draft.dueDate ? ` · ${dayLabel(draft.dueDate, today)}` : ''}
          </Text>
          <DateShortcuts today={today} value={draft.dueDate} onPick={(dueDate) => change({ dueDate, ...(dueDate ? {} : { repeat: null }) })} />
          <Calendar today={today} value={draft.dueDate} onPick={(dueDate) => change({ dueDate })} />
        </View>

        <View className="gap-3">
          <Text className="text-sm font-semibold text-muted dark:text-muted-dark">Repeat</Text>
          <ChoiceChips
            label="Repeat"
            selected={draft.repeat ?? 'never'}
            onSelect={(v) => change(v === 'never' ? { repeat: null } : { repeat: v, dueDate: draft.dueDate ?? today })}
            options={[
              { value: 'never', label: 'Never' },
              { value: 'daily', label: 'Every day' },
              { value: 'weekly', label: 'Every week' },
              { value: 'monthly', label: 'Every month' },
            ]}
          />
        </View>

        {lists.length > 1 ? (
          <View className="gap-3">
            <Text className="text-sm font-semibold text-muted dark:text-muted-dark">List</Text>
            <ChoiceChips label="List" selected={draft.listId} onSelect={(listId) => change({ listId })} options={lists.map((l) => ({ value: l.listId, label: l.name }))} />
          </View>
        ) : null}
      </ScrollView>
      <KeyboardSpacer />
    </Screen>
  );
}
