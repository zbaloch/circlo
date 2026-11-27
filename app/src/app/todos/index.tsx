import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useNavigation } from "expo-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  FlatList,
  LayoutAnimation,
  Pressable,
  SectionList,
  View,
} from "react-native";
import ReorderableList, {
  reorderItems,
  useReorderableDrag,
} from "react-native-reorderable-list";

import { ActionSheet, type SheetAction } from "@/components/action-sheet";
import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { KeyboardSpacer } from "@/components/keyboard-spacer";
import { Screen } from "@/components/screen";
import {
  ListNameSheet,
  QuickAdd,
  TodoRow,
  ViewPicker,
} from "@/components/todo-ui";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { showAlert } from "@/lib/dialog";
import { showToast } from "@/lib/toast";
import {
  addDays,
  dayLabel,
  listTodos,
  loadCompleted,
  noDateTodos,
  todayIso,
  todayTodos,
  TODAY,
  upcomingGroups,
  viewLabel,
  type QuickAdd as Parsed,
  type Todo,
  type TodoView,
} from "@/lib/todos";
import {
  addListNow,
  addTodoNow,
  completeTodoNow,
  deleteListNow,
  refreshTodos,
  renameListNow,
  reopenTodoNow,
  reorderTodosNow,
  useTodos,
} from "@/lib/todos-store";
import { useNow } from "@/lib/use-now";
import { usePalette } from "@/theme/use-palette";

/** How long a ticked to-do stays, checked, before it slides away (tapping it again in that moment undoes it). */
export const TICK_MS = 1000;

/**
 * Todos (2.0; owner decision 2026-11-27): my own to-do lists, Things-calm (no badges or counts). A picker at the top
 * chooses what to look at (Today, Upcoming, No date, or a list); quick add at the bottom reads dates in words. In a
 * list the order is mine (long-press to drag); Today and Upcoming sort by date.
 */
export default function TodosScreen() {
  const navigation = useNavigation();
  const palette = usePalette();
  const now = useNow();
  const today = todayIso(new Date(now));
  const { lists, todos, loaded } = useTodos();
  const [view, setView] = useState<TodoView>(TODAY);
  const [picking, setPicking] = useState(false);
  const [naming, setNaming] = useState<{
    title: string;
    initial: string;
    save: (name: string) => Promise<void>;
  } | null>(null);
  const [sheet, setSheet] = useState<SheetAction[] | null>(null);
  const [error, setError] = useState<string>();
  const [ticking, setTicking] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useFocusEffect(
    useCallback(() => {
      refreshTodos().then(
        () => setError(undefined),
        () => setError("Couldn’t load your to-dos. Check your connection."),
      );
    }, []),
  );
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  // A list that's gone (deleted here or elsewhere) falls back to Today.
  const shown: TodoView =
    view.kind === "list" &&
    loaded &&
    !lists.some((l) => l.listId === view.listId)
      ? TODAY
      : view;
  const list =
    shown.kind === "list"
      ? lists.find((l) => l.listId === shown.listId)
      : undefined;
  const listNames = new Map(lists.map((l) => [l.listId, l.name]));

  const newList = () =>
    setNaming({
      title: "New list",
      initial: "",
      save: async (name) => {
        try {
          const made = await addListNow(name);
          setView({ kind: "list", listId: made.listId });
        } catch {
          showToast("Couldn’t add the list. Try again.");
        }
      },
    });

  // ⋯ only while looking at a list: Rename list, and Delete list (not General). New list is in the picker.
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
                  label: "Rename list",
                  onPress: () =>
                    setNaming({
                      title: "Rename list",
                      initial: list.name,
                      save: (name) =>
                        renameListNow(list.listId, name).catch(() =>
                          showToast("Couldn’t rename it. Try again."),
                        ),
                    }),
                },
                ...(!list.general
                  ? [
                      {
                        label: "Delete list",
                        destructive: true,
                        onPress: () =>
                          showAlert(
                            `Delete ${list.name}?`,
                            "Its to-dos are deleted with it.",
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Delete",
                                style: "destructive",
                                onPress: () => {
                                  deleteListNow(list.listId).then(
                                    () => setView(TODAY),
                                    () =>
                                      showToast(
                                        "Couldn’t delete it. Try again.",
                                      ),
                                  );
                                },
                              },
                            ],
                          ),
                      },
                    ]
                  : []),
              ])
            }
          >
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined,
    );
    setTicking((s) => new Set(s).add(t.todoId));
    timers.current.set(
      t.todoId,
      setTimeout(() => {
        timers.current.delete(t.todoId);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        completeTodoNow(t.todoId, todayIso())
          .catch(() => showToast("Couldn’t tick it. Try again."))
          .finally(() => setTicking((s) => without(s, t.todoId)));
      }, TICK_MS),
    );
  };

  const open = (t: Todo) =>
    router.push({ pathname: "/todos/[id]", params: { id: t.todoId } });

  const add = async (q: Parsed) => {
    const dueDate =
      q.dueDate ??
      (shown.kind === "today"
        ? today
        : shown.kind === "upcoming"
          ? addDays(today, 1)
          : null);
    const listId = shown.kind === "list" ? shown.listId : null;
    try {
      await addTodoNow({
        title: q.title,
        notes: null,
        dueDate,
        repeat: q.repeat,
        listId,
      });
    } catch {
      showToast("Couldn’t add it. Try again.");
      throw new Error("not added");
    }
    // Said when it lands somewhere else than what I'm looking at.
    if (shown.kind === "today" && dueDate && dueDate > today)
      showToast(`Added for ${dayLabel(dueDate, today)}`);
    if (shown.kind === "nodate" && dueDate)
      showToast(`Added for ${dayLabel(dueDate, today)}`);
  };

  if (!loaded) {
    return (
      <Screen>
        {error ? (
          <EmptyState icon="checkbox-outline" title="Todos" body={error} />
        ) : (
          <Spinner className="flex-1 py-10" />
        )}
      </Screen>
    );
  }

  const row = (t: Todo, showList: boolean, drag?: () => void) => (
    <TodoRow
      todo={t}
      today={today}
      listName={
        showList && lists.length > 1 ? listNames.get(t.listId) : undefined
      }
      checked={ticking.has(t.todoId)}
      onToggle={() => toggle(t)}
      onOpen={() => open(t)}
      onLongPress={drag}
    />
  );
  const label = viewLabel(shown, lists);
  const placeholder =
    shown.kind === "list"
      ? `Add to ${label}`
      : shown.kind === "nodate"
        ? "Add a to-do"
        : `Add to ${label}`;

  return (
    <Screen>
      <View className="flex-row items-center border-b border-border px-4 py-2.5 dark:border-border-dark">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Showing ${label}`}
          accessibilityHint="Choose what to show: Today, Upcoming, No date or a list"
          onPress={() => setPicking(true)}
          className="shrink flex-row items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark"
        >
          <Text
            numberOfLines={1}
            className="shrink font-semibold text-ink dark:text-ink-dark"
          >
            {label}
          </Text>
          <Icon name="chevron-down" size={16} color={palette.ink} />
        </Pressable>
      </View>
      {error ? (
        <Text className="px-4 py-2 text-center text-sm text-danger dark:text-danger-dark">
          {error}
        </Text>
      ) : null}

      <View className="flex-1">
        {shown.kind === "today" ? (
          <FlatList
            data={todayTodos(todos, today)}
            keyExtractor={(t) => t.todoId}
            renderItem={({ item }) => row(item, true)}
            ListEmptyComponent={
              <Empty
                title="Nothing for today"
                body="Add a to-do below. Dates work in words: “Call mum tomorrow”, “Pay rent every month”."
              />
            }
            keyboardShouldPersistTaps="handled"
          />
        ) : shown.kind === "upcoming" ? (
          <SectionList
            sections={upcomingGroups(todos, today).map((g) => ({
              title: g.title,
              data: g.todos,
            }))}
            keyExtractor={(t) => t.todoId}
            renderItem={({ item }) => row(item, true)}
            renderSectionHeader={({ section }) => (
              <Text
                accessibilityRole="header"
                className="bg-surface px-4 pb-1 pt-4 text-sm font-bold text-ink dark:bg-surface-dark dark:text-ink-dark"
              >
                {section.title}
              </Text>
            )}
            stickySectionHeadersEnabled={false}
            ListEmptyComponent={
              <Empty
                title="Nothing coming up"
                body="To-dos with a date after today show here, by day."
              />
            }
            keyboardShouldPersistTaps="handled"
          />
        ) : shown.kind === "nodate" ? (
          <FlatList
            data={noDateTodos(todos)}
            keyExtractor={(t) => t.todoId}
            renderItem={({ item }) => row(item, true)}
            ListEmptyComponent={
              <Empty
                title="Nothing without a date"
                body="To-dos for some day, with no date yet, gather here."
              />
            }
            keyboardShouldPersistTaps="handled"
          />
        ) : (
          <ListView
            listId={shown.listId}
            todos={listTodos(todos, shown.listId)}
            name={label}
            row={row}
          />
        )}
      </View>

      <QuickAdd placeholder={placeholder} today={today} onAdd={add} />
      <KeyboardSpacer />

      <ViewPicker
        visible={picking}
        lists={lists}
        selected={shown}
        onSelect={setView}
        onNewList={newList}
        onClose={() => setPicking(false)}
      />
      <ListNameSheet
        visible={!!naming}
        title={naming?.title ?? ""}
        initial={naming?.initial ?? ""}
        onSave={async (name) => naming?.save(name)}
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
      <EmptyState icon="checkbox-outline" title={title} body={body} />
    </View>
  );
}

/** One list: my order (long-press a to-do to drag it), and its folded Completed section at the end. */
function ListView({
  listId,
  todos,
  name,
  row,
}: {
  listId: string;
  todos: Todo[];
  name: string;
  row: (t: Todo, showList: boolean, drag?: () => void) => ReactElement;
}) {
  return (
    <ReorderableList
      data={todos}
      keyExtractor={(t) => t.todoId}
      onReorder={({ from, to }) => {
        const ordered = reorderItems(todos, from, to).map((t) => t.todoId);
        reorderTodosNow(listId, ordered).catch(() =>
          showToast("Couldn’t move it. Try again."),
        );
      }}
      renderItem={({ item }) => <DraggableRow todo={item} row={row} />}
      ListEmptyComponent={
        <Empty title={`Nothing in ${name}`} body="Add a to-do below." />
      }
      ListFooterComponent={<Completed listId={listId} />}
      keyboardShouldPersistTaps="handled"
    />
  );
}

function DraggableRow({
  todo,
  row,
}: {
  todo: Todo;
  row: (t: Todo, showList: boolean, drag?: () => void) => ReactElement;
}) {
  const drag = useReorderableDrag();
  return row(todo, false, drag);
}

/** A list's completed to-dos, folded away; unticking one puts it back at the end of the list. */
function Completed({ listId }: { listId: string }) {
  const palette = usePalette();
  const now = useNow();
  const today = todayIso(new Date(now));
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Todo[] | null>(null);
  const { todos } = useTodos();
  // Fetched when opened, and again when the list's open to-dos change (something was just ticked).
  const openCount = todos.filter((t) => t.listId === listId).length;
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadCompleted(listId).then(
      (c) => live && setDone(c),
      () => live && setDone([]),
    );
    return () => {
      live = false;
    };
  }, [open, listId, openCount]);

  return (
    <View className="pb-6 pt-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        className="flex-row items-center gap-1.5 px-4 py-3"
      >
        <Icon
          name={open ? "chevron-down" : "chevron-forward"}
          size={16}
          color={palette.muted}
        />
        <Text className="text-sm font-semibold text-muted dark:text-muted-dark">
          Completed
        </Text>
      </Pressable>
      {open && done === null ? <Spinner className="py-4" /> : null}
      {open && done?.length === 0 ? (
        <Text className="px-4 pb-2 text-sm text-muted dark:text-muted-dark">
          Nothing completed in the last 30 days.
        </Text>
      ) : null}
      {open
        ? done?.map((t) => (
            <TodoRow
              key={t.todoId}
              todo={t}
              today={today}
              checked
              onToggle={() => {
                setDone((d) => d && d.filter((x) => x.todoId !== t.todoId));
                reopenTodoNow(t.todoId).catch(() =>
                  showToast("Couldn’t untick it. Try again."),
                );
              }}
            />
          ))
        : null}
    </View>
  );
}
