import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { toggleTodo } from '@/components/desk/todo-actions';
import { TodoRow } from '@/components/desk/todo-row';
import { Screen } from '@/components/screen';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { boardLine, localDate, type DeskBoard, type DeskTodo } from '@/lib/desk';
import { fetchBoards, fetchToday } from '@/lib/desk-api';
import { DESK_ENABLED } from '@/lib/features';
import { usePalette } from '@/theme/use-palette';

/** Behind lib/features' DESK_ENABLED: when the Desk is switched off, a direct link lands on Home. */
export default function DeskScreenRoute() {
  return DESK_ENABLED ? <DeskScreen /> : <Redirect href="/" />;
}

function Heading({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" className="px-4 pb-1 pt-5 text-xl font-extrabold text-ink dark:text-ink-dark">
      {children}
    </Text>
  );
}

const openBoard = (id: string) => router.push({ pathname: '/desk/board/[id]', params: { id } });

/**
 * The Desk (owner decision 2026-11-14, boards 2026-11-15): a personal space, useful before you've connected with
 * anyone. Today first (what's due or late on every board), then your boards, each with its own to-dos, notes and files.
 * Nothing in it is ever shared; only its owner can see it, and the server answers 404 to anyone else.
 */
export function DeskScreen() {
  const palette = usePalette();
  const [today, setToday] = useState(localDate());
  const [due, setDue] = useState<DeskTodo[] | null>(null);
  const [boards, setBoards] = useState<DeskBoard[] | null>(null);
  const [error, setError] = useState<string>();
  const [pulling, setPulling] = useState(false);

  const load = useCallback(async () => {
    const day = localDate();
    setToday(day);
    try {
      const [d, b] = await Promise.all([fetchToday(day), fetchBoards()]);
      setDue(d);
      setBoards(b);
      setError(undefined);
    } catch {
      setError('Couldn’t load your Desk. Pull to try again.');
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
    <Screen>
      <ScrollView refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} />} contentContainerClassName="pb-28">
        <View className="flex-row items-center gap-2 px-4 pt-3">
          <Icon name="lock-closed-outline" size={14} color={palette.muted} />
          <Text className="flex-1 text-[13px] text-muted dark:text-muted-dark">Only you can see your Desk. Nothing here is ever shared.</Text>
        </View>
        {error ? <Text className="px-4 pt-3 text-center text-sm text-danger dark:text-danger-dark">{error}</Text> : null}

        <Heading>Today</Heading>
        {due && due.length === 0 ? <Text className="px-4 py-2 text-[15px] text-muted dark:text-muted-dark">Nothing due today.</Text> : null}
        {(due ?? []).map((t) => (
          <TodoRow
            key={t.id}
            todo={t}
            today={today}
            showBoard
            onToggle={() => {
              setDue((d) => d?.filter((x) => x.id !== t.id) ?? null);
              toggleTodo(t, today, load);
            }}
            onOpen={() => router.push({ pathname: '/desk/todo/[id]', params: { id: t.id } })}
          />
        ))}

        <Heading>Boards</Heading>
        {boards && boards.length === 0 ? (
          <Text className="px-4 py-2 text-[15px] leading-[21px] text-muted dark:text-muted-dark">
            A board for each part of your life: Home, a trip, Taxes 2026, a side project. Each has its own to-dos, notes and files.
          </Text>
        ) : null}
        {(boards ?? []).map((b) => (
          <Pressable
            key={b.id}
            accessibilityRole="link"
            onPress={() => openBoard(b.id)}
            className="flex-row items-center gap-3 px-4 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
            <View className="h-10 w-10 items-center justify-center rounded-md bg-primary-soft dark:bg-primary-soft-dark">
              <Icon name="board-outline" size={22} color={palette.primary} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-[15px] font-semibold text-ink dark:text-ink-dark">{b.name}</Text>
              {b.description ? (
                <Text numberOfLines={1} className="text-[14px] text-muted dark:text-muted-dark">
                  {b.description}
                </Text>
              ) : null}
              <Text className="text-[13px] text-muted dark:text-muted-dark">{boardLine(b)}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={palette.muted} />
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={() => router.push('/desk/board-form')} className="flex-row items-center gap-3 px-4 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
          <View className="h-10 w-10 items-center justify-center">
            <Icon name="add" size={24} color={palette.primary} />
          </View>
          <Text className="text-[15px] font-semibold text-primary dark:text-primary-dark">New board</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
