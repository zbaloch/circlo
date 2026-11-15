import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import { localDate, type DeskTodo } from '@/lib/desk';
import { createTodo, fetchBoardTodos, type BoardTodos as Todos } from '@/lib/desk-api';
import { showAlert } from '@/lib/dialog';
import { usePalette } from '@/theme/use-palette';

import { toggleTodo } from './todo-actions';
import { TodoRow } from './todo-row';

/**
 * A board's to-dos: the open ones (oldest first) with a box to add more, and the done ones folded away underneath.
 * Tapping one opens it, for its description, due date, repeat and comments.
 */
export function BoardTodos({ boardId, onChange }: { boardId: string; onChange?: () => void }) {
  const palette = usePalette();
  const [todos, setTodos] = useState<Todos | null>(null);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [pulling, setPulling] = useState(false);
  const today = localDate();

  const load = useCallback(async () => {
    try {
      setTodos(await fetchBoardTodos(boardId));
      setError(undefined);
    } catch {
      setError('Couldn’t load the to-dos. Pull to try again.');
    }
  }, [boardId]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const reload = () => {
    load();
    onChange?.();
  };

  const add = async () => {
    const title = draft.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      const t = await createTodo({ boardId, title });
      setTodos((l) => (l ? { ...l, open: [...l.open, t] } : l));
      setDraft('');
      onChange?.();
    } catch {
      showAlert('Couldn’t add that', 'Check your connection and try again.');
    } finally {
      setAdding(false);
    }
  };

  const toggle = (t: DeskTodo) => {
    // Move it straight away; the reload puts it (and any repeat) where the server says.
    setTodos((l) =>
      l
        ? t.doneAt
          ? { done: l.done.filter((x) => x.id !== t.id), open: [...l.open, { ...t, doneAt: null }] }
          : { open: l.open.filter((x) => x.id !== t.id), done: [{ ...t, doneAt: new Date().toISOString() }, ...l.done] }
        : l,
    );
    toggleTodo(t, today, reload);
  };
  const open = (t: DeskTodo) => router.push({ pathname: '/desk/todo/[id]', params: { id: t.id } });

  return (
    <View className="flex-1">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={async () => {
              setPulling(true);
              await load();
              setPulling(false);
            }}
          />
        }
        contentContainerClassName="pb-10">
        {error ? <Text className="px-4 pt-3 text-center text-sm text-danger dark:text-danger-dark">{error}</Text> : null}
        {(todos?.open ?? []).map((t) => (
          <TodoRow key={t.id} todo={t} today={today} onToggle={() => toggle(t)} onOpen={() => open(t)} />
        ))}
        <View className="flex-row items-center gap-3 px-4 py-2">
          <Icon name="add" size={24} color={palette.muted} />
          <TextInput
            accessibilityLabel="Add a to-do"
            placeholder="Add a to-do"
            placeholderTextColor={palette.muted}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            submitBehavior="submit"
            returnKeyType="done"
            maxLength={500}
            autoCapitalize="sentences"
            className="flex-1 py-2 text-[15px] text-ink dark:text-ink-dark"
          />
        </View>
        {todos && todos.open.length === 0 && todos.done.length === 0 ? (
          <Text className="px-4 py-2 text-[15px] leading-[21px] text-muted dark:text-muted-dark">
            Add what needs doing. Open one to give it a description, a due date, or a repeat for things that come back.
          </Text>
        ) : null}
        {todos && todos.done.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setShowDone(!showDone)} className="flex-row items-center gap-2 px-4 pb-1 pt-4 active:opacity-60">
            <Icon name={showDone ? 'chevron-down' : 'chevron-forward'} size={16} color={palette.muted} />
            <Text className="text-[15px] font-semibold text-muted dark:text-muted-dark">{showDone ? 'Hide done' : `Show ${todos.done.length} done`}</Text>
          </Pressable>
        ) : null}
        {showDone ? (todos?.done ?? []).map((t) => <TodoRow key={t.id} todo={t} today={today} onToggle={() => toggle(t)} onOpen={() => open(t)} />) : null}
      </ScrollView>
      <KeyboardSpacer />
    </View>
  );
}
