import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { ContentText } from '@/components/content-text';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Screen } from '@/components/screen';
import { ChoiceChips } from '@/components/todo-ui';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text, TextInput } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { fullTime } from '@/lib/time';
import { showToast } from '@/lib/toast';
import { addNote, deleteNote, loadNotes, type Todo, type TodoNote } from '@/lib/todos';
import { bumpNotes, deleteTodoNow, refreshTodos, saveTodoNow, useTodos } from '@/lib/todos-store';
import { usePalette } from '@/theme/use-palette';

/** How long after the last change a to-do's title or list saves itself (and when I leave the screen). */
export const SAVE_AFTER_MS = 600;

/**
 * One to-do: its title and list (saved by themselves as I change them), then its notes, a log of dated entries like
 * comments, oldest first, and a field at the bottom to add the next one. A long press on a note deletes it.
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
        {loaded ? <EmptyState icon="list-todo" title="Not here any more" body="This to-do was ticked or deleted." /> : <Spinner className="flex-1 py-10" />}
      </Screen>
    );
  }
  return <Editor key={todo.todoId} todo={todo} />;
}

function Editor({ todo }: { todo: Todo }) {
  const navigation = useNavigation();
  const palette = usePalette();
  const { lists } = useTodos();
  const [title, setTitle] = useState(todo.title);
  const [listId, setListId] = useState(todo.listId);
  const [notes, setNotes] = useState<TodoNote[] | null>(null);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const saved = useRef(JSON.stringify({ title: todo.title, listId: todo.listId }));
  // Once deleted, nothing more is saved (the screen closes after it).
  const deleted = useRef(false);
  const latest = useRef({ title, listId });
  const list = useRef<FlatList<TodoNote>>(null);
  useEffect(() => {
    latest.current = { title, listId };
  }, [title, listId]);

  useEffect(() => {
    let live = true;
    loadNotes(todo.todoId).then(
      (n) => live && setNotes(n),
      () => live && setNotes([]),
    );
    return () => {
      live = false;
    };
  }, [todo.todoId]);

  // The title and list save themselves a moment after a change, and on the way out.
  const save = useRef(async (fields: { title: string; listId: string }) => {
    const t = fields.title.trim();
    const key = JSON.stringify({ title: t, listId: fields.listId });
    if (deleted.current || !t || key === saved.current) return;
    saved.current = key;
    await saveTodoNow(todo.todoId, { title: t, listId: fields.listId }).catch(() => showToast('Couldn’t save the to-do. Try again.'));
  });
  useEffect(() => {
    const timer = setTimeout(() => void save.current({ title, listId }), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [title, listId]);
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
            showAlert('Delete this to-do?', 'Its notes are deleted with it.', [
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

  const add = async () => {
    const body = note.trim();
    if (!body || adding) return;
    setAdding(true);
    try {
      const made = await addNote(todo.todoId, body);
      setNotes((n) => [...(n ?? []), made]);
      bumpNotes(todo.todoId, 1);
      setNote('');
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      showToast('Couldn’t add the note. Try again.');
    } finally {
      setAdding(false);
    }
  };

  const remove = (n: TodoNote) =>
    showAlert('Delete this note?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setNotes((all) => all && all.filter((x) => x.noteId !== n.noteId));
          bumpNotes(todo.todoId, -1);
          deleteNote(todo.todoId, n.noteId).catch(() => {
            setNotes((all) => (all ? [...all, n].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : all));
            bumpNotes(todo.todoId, 1);
            showToast('Couldn’t delete the note. Try again.');
          });
        },
      },
    ]);

  return (
    <Screen>
      <FlatList
        ref={list}
        data={notes ?? []}
        keyExtractor={(n) => n.noteId}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-6"
        ListHeaderComponent={
          <View className="gap-5 px-5 pb-2 pt-4">
            <TextInput
              accessibilityLabel="Title"
              value={title}
              onChangeText={setTitle}
              multiline
              maxLength={500}
              placeholder="To-do"
              placeholderTextColor={palette.muted}
              className="text-2xl font-bold text-ink dark:text-ink-dark"
            />
            {lists.length > 1 ? (
              <View className="gap-3">
                <Text className="text-sm font-semibold text-muted dark:text-muted-dark">List</Text>
                <ChoiceChips label="List" selected={listId} onSelect={setListId} options={lists.map((l) => ({ value: l.listId, label: l.name }))} />
              </View>
            ) : null}
            <Text accessibilityRole="header" className="pt-2 text-sm font-semibold text-muted dark:text-muted-dark">
              Notes
            </Text>
            {notes === null ? <Spinner className="py-4" /> : null}
            {notes?.length === 0 ? (
              <Text className="text-[15px] text-muted dark:text-muted-dark">No notes yet. Add one below; each keeps the time you wrote it.</Text>
            ) : null}
          </View>
        }
        renderItem={({ item: n }) => (
          <Pressable
            accessibilityRole="text"
            accessibilityHint="Long press to delete"
            onLongPress={() => remove(n)}
            delayLongPress={300}
            className="mx-5 mb-3 gap-1 rounded-2xl bg-surface-raised px-4 py-3 active:opacity-80 dark:bg-surface-raised-dark">
            <ContentText text={n.body} className="text-base leading-6 text-ink dark:text-ink-dark" />
            <Text className="text-xs text-muted dark:text-muted-dark">{fullTime(Date.parse(n.createdAt))}</Text>
          </Pressable>
        )}
      />
      <View className="flex-row items-end gap-2 border-t border-border bg-surface px-3 py-2 dark:border-border-dark dark:bg-surface-dark">
        <TextInput
          accessibilityLabel="New note"
          placeholder="Add a note"
          placeholderTextColor={palette.muted}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={10_000}
          className="max-h-28 flex-1 rounded-2xl bg-surface-raised px-4 py-2 text-base text-ink dark:bg-surface-raised-dark dark:text-ink-dark"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add note"
          disabled={!note.trim() || adding}
          onPress={() => void add()}
          className={`h-10 w-10 items-center justify-center rounded-full bg-primary dark:bg-primary-dark ${!note.trim() || adding ? 'opacity-50' : ''}`}>
          {adding ? <Spinner tone="onPrimary" /> : <Icon name="arrow-up" size={20} color={palette.onPrimary} />}
        </Pressable>
      </View>
      <KeyboardSpacer />
    </Screen>
  );
}
