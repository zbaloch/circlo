import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { NameSheet } from '@/components/desk/name-sheet';
import { toggleTodo } from '@/components/desk/todo-actions';
import { TodoRow } from '@/components/desk/todo-row';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import { localDate, type DeskTodo } from '@/lib/desk';
import { createTodo, deleteList, fetchList, renameList, type ListDetail } from '@/lib/desk-api';
import { showAlert } from '@/lib/dialog';
import { usePalette } from '@/theme/use-palette';

/**
 * A to-do list: its open to-dos (oldest first) with a box to add more, and the done ones folded away underneath. The
 * ⋯ button renames or deletes the list.
 */
export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const palette = usePalette();
  const [list, setList] = useState<ListDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [menu, setMenu] = useState<SheetAction[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const today = localDate();

  const load = useCallback(async () => {
    try {
      setList(await fetchList(id));
    } catch {
      setMissing(true);
    }
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    navigation.setOptions({
      title: list?.name ?? 'List',
      headerRight: () => (
        <IconButton
          accessibilityLabel="List options"
          onPress={() =>
            setMenu([
              { label: 'Rename list', onPress: () => setRenaming(true) },
              {
                label: 'Delete list',
                destructive: true,
                onPress: () =>
                  showAlert('Delete this list?', 'Its to-dos are deleted too. This can’t be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => deleteList(id).then(() => router.back(), () => showAlert('Couldn’t delete', 'Check your connection and try again.')),
                    },
                  ]),
              },
            ])
          }>
          <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
        </IconButton>
      ),
    });
  }, [navigation, list?.name, id, palette.ink]);

  const add = async () => {
    const title = draft.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      const t = await createTodo({ listId: id, title });
      setList((l) => (l ? { ...l, open: [...l.open, t] } : l));
      setDraft('');
    } catch {
      showAlert('Couldn’t add that', 'Check your connection and try again.');
    } finally {
      setAdding(false);
    }
  };

  const toggle = (t: DeskTodo) => {
    // Move it straight away; the reload puts it (and any repeat) where the server says.
    setList((l) =>
      l
        ? t.doneAt
          ? { ...l, done: l.done.filter((x) => x.id !== t.id), open: [...l.open, { ...t, doneAt: null }] }
          : { ...l, open: l.open.filter((x) => x.id !== t.id), done: [{ ...t, doneAt: new Date().toISOString() }, ...l.done] }
        : l,
    );
    toggleTodo(t, today, load);
  };
  const open = (t: DeskTodo) => router.push({ pathname: '/desk/todo/[id]', params: { id: t.id } });

  if (missing) {
    return (
      <View className="flex-1 bg-surface p-5 dark:bg-surface-dark">
        <Text className="text-muted dark:text-muted-dark">This list no longer exists.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="pb-10">
        {(list?.open ?? []).map((t) => (
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
        {list && list.done.length > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setShowDone(!showDone)} className="flex-row items-center gap-2 px-4 pb-1 pt-4 active:opacity-60">
            <Icon name={showDone ? 'chevron-down' : 'chevron-forward'} size={16} color={palette.muted} />
            <Text className="text-[15px] font-semibold text-muted dark:text-muted-dark">{showDone ? 'Hide done' : `Show ${list.done.length} done`}</Text>
          </Pressable>
        ) : null}
        {showDone ? (list?.done ?? []).map((t) => <TodoRow key={t.id} todo={t} today={today} onToggle={() => toggle(t)} onOpen={() => open(t)} />) : null}
      </ScrollView>
      <KeyboardSpacer />
      <ActionSheet actions={menu} onClose={() => setMenu(null)} />
      <NameSheet
        visible={renaming}
        title="Rename list"
        initial={list?.name ?? ''}
        actionLabel="Save"
        onClose={() => setRenaming(false)}
        onSave={async (name) => {
          await renameList(id, name);
          setList((l) => (l ? { ...l, name } : l));
        }}
      />
    </View>
  );
}
