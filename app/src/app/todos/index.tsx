import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { FlatList, LayoutAnimation, View } from 'react-native';
import ReorderableList, { reorderItems, useReorderableDrag } from 'react-native-reorderable-list';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Screen } from '@/components/screen';
import { ListNameSheet, ListPicker, QuickAdd, TodoFilterBar, TodoRow } from '@/components/todo-ui';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { showToast } from '@/lib/toast';
import { ALL_TODOS, allItems, dropInAll, inList, listLabel, loadCompleted, type AllItem, type Todo, type TodoFilter } from '@/lib/todos';
import {
  addListNow,
  addTodoNow,
  completeTodoNow,
  deleteListNow,
  deleteTodoNow,
  refreshTodos,
  renameListNow,
  reopenTodoNow,
  reorderTodosNow,
  saveTodoNow,
  useTodos,
} from '@/lib/todos-store';
import { usePalette } from '@/theme/use-palette';

/** How long a ticked to-do stays, checked, before it slides away (tapping it again in that moment undoes it). */
export const TICK_MS = 1000;

type Row = (t: Todo, showList: boolean, drag?: () => void) => ReactElement;

/**
 * Todos (2.0; owner decisions 2026-11-27/28): my own to-do lists, like pen and paper (no dates or badges). Above
 * them, a list picker ("All" to start, or one list) and a Completed toggle. Everywhere, a long press picks a to-do up
 * to move it (in All, dropping it under another list's heading moves it there) and swiping it left deletes it. Quick add at the
 * bottom. A to-do's notes are on its own screen.
 */
export default function TodosScreen() {
  const navigation = useNavigation();
  const palette = usePalette();
  const { lists, todos, loaded } = useTodos();
  const [chosen, setChosen] = useState<TodoFilter>(ALL_TODOS);
  const [picking, setPicking] = useState(false);
  const [naming, setNaming] = useState<{ title: string; initial: string; save: (name: string) => Promise<void> } | null>(null);
  const [sheet, setSheet] = useState<SheetAction[] | null>(null);
  const [error, setError] = useState<string>();
  const [ticking, setTicking] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useFocusEffect(
    useCallback(() => {
      refreshTodos().then(
        () => setError(undefined),
        () => setError('Couldn’t load your to-dos. Check your connection.'),
      );
    }, []),
  );
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  // A list that's gone (deleted here or elsewhere) falls back to All.
  const list = chosen.listId ? lists.find((l) => l.listId === chosen.listId) : undefined;
  const filter: TodoFilter = { listId: list ? list.listId : null, completed: chosen.completed };
  const listNames = new Map(lists.map((l) => [l.listId, l.name]));

  const newList = () =>
    setNaming({
      title: 'New list',
      initial: '',
      save: async (name) => {
        try {
          const made = await addListNow(name);
          setChosen((f) => ({ ...f, listId: made.listId }));
        } catch {
          showToast('Couldn’t add the list. Try again.');
        }
      },
    });

  // ⋯ only while looking at one list: Rename list, and Delete list (not General). New list is in the picker.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        list ? (
          <IconButton
            accessibilityLabel="More"
            testID="todos-more"
            className="mr-2"
            onPress={() =>
              setSheet([
                {
                  label: 'Rename list',
                  onPress: () =>
                    setNaming({
                      title: 'Rename list',
                      initial: list.name,
                      save: (name) => renameListNow(list.listId, name).catch(() => showToast('Couldn’t rename it. Try again.')),
                    }),
                },
                ...(!list.general
                  ? [
                      {
                        label: 'Delete list',
                        destructive: true,
                        onPress: () =>
                          showAlert(`Delete ${list.name}?`, 'Its to-dos and their notes are deleted with it.', [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: () => {
                                deleteListNow(list.listId).then(
                                  () => setChosen((f) => ({ ...f, listId: null })),
                                  () => showToast('Couldn’t delete it. Try again.'),
                                );
                              },
                            },
                          ]),
                      },
                    ]
                  : []),
              ])
            }>
            <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
          </IconButton>
        ) : null,
    });
  }, [navigation, palette.ink, list]);

  // Ticking: a check and a light tap at once; a moment later it slides away (tapping again in that moment undoes it).
  const toggle = (t: Todo) => {
    const pending = timers.current.get(t.todoId);
    if (pending) {
      clearTimeout(pending);
      timers.current.delete(t.todoId);
      setTicking((s) => without(s, t.todoId));
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setTicking((s) => new Set(s).add(t.todoId));
    timers.current.set(
      t.todoId,
      setTimeout(() => {
        timers.current.delete(t.todoId);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        completeTodoNow(t.todoId)
          .catch(() => showToast('Couldn’t tick it. Try again.'))
          .finally(() => setTicking((s) => without(s, t.todoId)));
      }, TICK_MS),
    );
  };

  const open = (t: Todo) => router.push({ pathname: '/todos/[id]', params: { id: t.todoId } });

  // Swiped away: gone at once, unless it has notes, which are asked about first.
  const remove = (t: Todo) => {
    const go = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      deleteTodoNow(t.todoId).catch(() => showToast('Couldn’t delete it. Try again.'));
    };
    if (t.noteCount > 0) {
      showAlert(`Delete “${t.title}”?`, 'Its notes are deleted with it.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: go },
      ]);
    } else go();
  };

  // Added to the list I'm looking at (General under All); when I'm looking at Completed, said so.
  const add = async (title: string) => {
    try {
      await addTodoNow({ title, listId: filter.listId });
    } catch {
      showToast('Couldn’t add it. Try again.');
      throw new Error('not added');
    }
    if (filter.completed) showToast(`Added to ${listLabel(lists, filter.listId) === 'All' ? 'General' : listLabel(lists, filter.listId)}`);
  };

  if (!loaded) {
    return <Screen>{error ? <EmptyState icon="list-todo" title="Todos" body={error} /> : <Spinner className="flex-1 py-10" />}</Screen>;
  }

  const row: Row = (t, showList, drag) => (
    <TodoRow
      todo={t}
      listName={showList && lists.length > 1 ? listNames.get(t.listId) : undefined}
      checked={ticking.has(t.todoId)}
      onToggle={() => toggle(t)}
      onOpen={() => open(t)}
      onDrag={drag}
      onDelete={() => remove(t)}
    />
  );
  const name = listLabel(lists, filter.listId);
  const all = !filter.listId;

  return (
    <Screen>
      <TodoFilterBar
        listLabel={name}
        completed={filter.completed}
        onPickList={() => setPicking(true)}
        onCompleted={(completed) => setChosen((f) => ({ ...f, completed }))}
      />
      {error ? <Text className="px-4 py-2 text-center text-sm text-danger dark:text-danger-dark">{error}</Text> : null}

      <View className="flex-1">
        {filter.completed ? (
          <CompletedList listId={filter.listId} showList={all && lists.length > 1} listNames={listNames} />
        ) : all ? (
          <AllView items={allItems(todos, lists)} empty={todos.length === 0} row={row} />
        ) : (
          <ListView listId={filter.listId!} todos={inList(todos, filter.listId)} name={name} row={row} />
        )}
      </View>

      <QuickAdd placeholder={all ? 'Add a to-do' : `Add to ${name}`} onAdd={add} />
      <KeyboardSpacer />

      <ListPicker
        visible={picking}
        lists={lists}
        selected={filter.listId}
        onSelect={(listId) => setChosen((f) => ({ ...f, listId }))}
        onNewList={newList}
        onClose={() => setPicking(false)}
      />
      <ListNameSheet
        visible={!!naming}
        title={naming?.title ?? ''}
        initial={naming?.initial ?? ''}
        onSave={async (n) => naming?.save(n)}
        onClose={() => setNaming(null)}
      />
      <ActionSheet actions={sheet} onClose={() => setSheet(null)} />
    </Screen>
  );
}

function without(s: Set<string>, id: string): Set<string> {
  const next = new Set(s);
  next.delete(id);
  return next;
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View className="h-[360px]">
      <EmptyState icon="list-todo" title={title} body={body} />
    </View>
  );
}

/**
 * All, as one list to drag in: each list's heading, then its to-dos. A to-do dropped under another heading moves to
 * that list, in the place it was dropped.
 */
function AllView({ items, empty, row }: { items: AllItem[]; empty: boolean; row: Row }) {
  const drop = async (from: number, to: number) => {
    const where = dropInAll(items, from, to);
    const moved = items[from];
    if (!where || moved?.kind !== 'todo') return;
    try {
      if (where.listId !== moved.todo.listId) await saveTodoNow(where.todoId, { title: moved.todo.title, listId: where.listId });
      await reorderTodosNow(where.listId, where.order);
    } catch {
      showToast('Couldn’t move it. Try again.');
    }
  };
  return (
    <ReorderableList
      data={items}
      keyExtractor={(i) => (i.kind === 'list' ? `list-${i.listId}` : i.todo.todoId)}
      onReorder={({ from, to }) => void drop(from, to)}
      renderItem={({ item }) =>
        item.kind === 'list' ? (
          <Text accessibilityRole="header" className="bg-surface px-4 pb-1 pt-4 text-sm font-bold text-ink dark:bg-surface-dark dark:text-ink-dark">
            {item.title}
          </Text>
        ) : (
          <DraggableRow todo={item.todo} row={row} />
        )
      }
      ListFooterComponent={empty ? <Empty title="Nothing to do" body="Write a to-do below, as you would on paper." /> : undefined}
      keyboardShouldPersistTaps="handled"
    />
  );
}

/** One list: my order (a long press picks a to-do up). */
function ListView({ listId, todos, name, row }: { listId: string; todos: Todo[]; name: string; row: Row }) {
  return (
    <ReorderableList
      data={todos}
      keyExtractor={(t) => t.todoId}
      onReorder={({ from, to }) => {
        const ordered = reorderItems(todos, from, to).map((t) => t.todoId);
        reorderTodosNow(listId, ordered).catch(() => showToast('Couldn’t move it. Try again.'));
      }}
      renderItem={({ item }) => <DraggableRow todo={item} row={row} />}
      ListEmptyComponent={<Empty title={`Nothing in ${name}`} body="Write a to-do below." />}
      keyboardShouldPersistTaps="handled"
    />
  );
}

function DraggableRow({ todo, row }: { todo: Todo; row: Row }) {
  const drag = useReorderableDrag();
  return row(todo, false, drag);
}

/** Completed to-dos (the last 30 days'), newest first, in one list or all; unticking one puts it back. */
function CompletedList({ listId, showList, listNames }: { listId: string | null; showList: boolean; listNames: Map<string, string> }) {
  const [done, setDone] = useState<Todo[] | null>(null);
  const { todos } = useTodos();
  // Fetched again when the open to-dos change (something was just ticked or added).
  const openCount = todos.length;
  useEffect(() => {
    let live = true;
    loadCompleted(listId).then(
      (c) => live && setDone(c),
      () => live && setDone([]),
    );
    return () => {
      live = false;
    };
  }, [listId, openCount]);

  if (done === null) return <Spinner className="py-10" />;
  return (
    <FlatList
      data={done}
      keyExtractor={(t) => t.todoId}
      renderItem={({ item: t }) => (
        <TodoRow
          todo={t}
          listName={showList ? listNames.get(t.listId) : undefined}
          checked
          onToggle={() => {
            setDone((d) => d && d.filter((x) => x.todoId !== t.todoId));
            reopenTodoNow(t.todoId).catch(() => showToast('Couldn’t untick it. Try again.'));
          }}
        />
      )}
      ListEmptyComponent={<Empty title="Nothing completed" body="Ticked to-dos stay here for 30 days, to find or untick." />}
      keyboardShouldPersistTaps="handled"
    />
  );
}
