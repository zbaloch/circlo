import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { localDate, type DeskList, type DeskTodo } from '@/lib/desk';
import { createList, fetchLists, fetchToday } from '@/lib/desk-api';
import { usePalette } from '@/theme/use-palette';

import { NameSheet } from './name-sheet';
import { toggleTodo } from './todo-actions';
import { TodoRow } from './todo-row';

export function listLine(l: DeskList): string {
  if (l.open > 0) return `${l.open} to do`;
  return l.done > 0 ? 'All done' : 'Empty';
}

function Heading({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" className="px-4 pb-1 pt-5 text-xl font-extrabold text-ink dark:text-ink-dark">
      {children}
    </Text>
  );
}

/** To-dos: what's due today or late in every list, then the lists themselves. */
export function TodosSection() {
  const palette = usePalette();
  const [today, setToday] = useState(localDate());
  const [due, setDue] = useState<DeskTodo[] | null>(null);
  const [lists, setLists] = useState<DeskList[] | null>(null);
  const [error, setError] = useState<string>();
  const [pulling, setPulling] = useState(false);
  const [naming, setNaming] = useState(false);

  const load = useCallback(async () => {
    const day = localDate();
    setToday(day);
    try {
      const [d, l] = await Promise.all([fetchToday(day), fetchLists()]);
      setDue(d);
      setLists(l);
      setError(undefined);
    } catch {
      setError('Couldn’t load your to-dos. Pull to try again.');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const pull = async () => {
    setPulling(true);
    await load();
    setPulling(false);
  };

  return (
    <View className="flex-1">
      <ScrollView refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} />} contentContainerClassName="pb-28">
        {error ? <Text className="px-4 pt-3 text-center text-sm text-danger dark:text-danger-dark">{error}</Text> : null}
        <Heading>Today</Heading>
        {due && due.length === 0 ? (
          <Text className="px-4 py-2 text-[15px] text-muted dark:text-muted-dark">Nothing due today.</Text>
        ) : null}
        {(due ?? []).map((t) => (
          <TodoRow
            key={t.id}
            todo={t}
            today={today}
            showList
            onToggle={() => {
              setDue((d) => d?.filter((x) => x.id !== t.id) ?? null);
              toggleTodo(t, today, load);
            }}
            onOpen={() => router.push({ pathname: '/desk/todo/[id]', params: { id: t.id } })}
          />
        ))}

        <Heading>Lists</Heading>
        {lists && lists.length === 0 ? (
          <Text className="px-4 py-2 text-[15px] leading-[21px] text-muted dark:text-muted-dark">
            Keep to-dos in lists: Home, Shopping, Work, a trip. Give them due dates, and repeats for the ones that come back.
          </Text>
        ) : null}
        {(lists ?? []).map((l) => (
          <Pressable
            key={l.id}
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/desk/list/[id]', params: { id: l.id } })}
            className="flex-row items-center gap-3 px-4 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
            <Icon name="desk-outline" size={22} color={palette.muted} />
            <View className="flex-1 gap-0.5">
              <Text className="text-[15px] font-semibold text-ink dark:text-ink-dark">{l.name}</Text>
              <Text className="text-[13px] text-muted dark:text-muted-dark">{listLine(l)}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={palette.muted} />
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={() => setNaming(true)} className="flex-row items-center gap-3 px-4 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
          <Icon name="add" size={22} color={palette.primary} />
          <Text className="text-[15px] font-semibold text-primary dark:text-primary-dark">New list</Text>
        </Pressable>
      </ScrollView>
      <NameSheet
        visible={naming}
        title="New list"
        actionLabel="Create list"
        onClose={() => setNaming(false)}
        onSave={async (name) => {
          const l = await createList(name);
          router.push({ pathname: '/desk/list/[id]', params: { id: l.id } });
        }}
      />
    </View>
  );
}
