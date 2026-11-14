import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { BoardFiles } from '@/components/desk/board-files';
import { BoardNotes } from '@/components/desk/board-notes';
import { BoardTodos } from '@/components/desk/board-todos';
import { IconButton } from '@/components/icon-button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { DeskBoard } from '@/lib/desk';
import { deleteBoard, fetchBoard } from '@/lib/desk-api';
import { showAlert } from '@/lib/dialog';
import { usePalette } from '@/theme/use-palette';

type Tab = 'todos' | 'notes' | 'files';
const TABS: { key: Tab; label: string }[] = [
  { key: 'todos', label: 'To-dos' },
  { key: 'notes', label: 'Notes' },
  { key: 'files', label: 'Files' },
];

/**
 * A board: its description, then its to-dos, notes and files in three tabs. ⋯ edits the board's name and description or
 * deletes it with everything on it.
 */
export default function BoardScreen() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const navigation = useNavigation();
  const palette = usePalette();
  const [board, setBoard] = useState<DeskBoard | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab && TABS.some((t) => t.key === initialTab) ? initialTab : 'todos');
  const [menu, setMenu] = useState<SheetAction[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Again on coming back, after editing the board.
  useFocusEffect(
    useCallback(() => {
      fetchBoard(id).then(setBoard, () => setMissing(true));
    }, [id]),
  );

  useEffect(() => {
    navigation.setOptions({
      title: board?.name ?? 'Board',
      headerRight: board
        ? () => (
            <IconButton
              accessibilityLabel="Board options"
              onPress={() =>
                setMenu([
                  { label: 'Edit board', onPress: () => router.push({ pathname: '/desk/board-form', params: { id: board.id } }) },
                  {
                    label: 'Delete board',
                    destructive: true,
                    onPress: () =>
                      showAlert(`Delete “${board.name}”?`, 'Its to-dos, notes and files are deleted too. This can’t be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => deleteBoard(board.id).then(() => router.back(), () => showAlert('Couldn’t delete', 'Check your connection and try again.')),
                        },
                      ]),
                  },
                ])
              }>
              <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
            </IconButton>
          )
        : undefined,
    });
  }, [navigation, board, palette.ink]);

  if (missing) {
    return (
      <View className="flex-1 bg-surface p-5 dark:bg-surface-dark">
        <Text className="text-muted dark:text-muted-dark">This board no longer exists.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      {board?.description ? (
        <Pressable accessibilityRole="button" accessibilityHint={showAll ? 'Shows less' : 'Shows all of it'} onPress={() => setShowAll(!showAll)} className="px-4 pt-3">
          <Text numberOfLines={showAll ? undefined : 3} className="text-[15px] leading-[21px] text-muted dark:text-muted-dark">
            {board.description}
          </Text>
        </Pressable>
      ) : null}
      <View accessibilityRole="tablist" className="flex-row border-b border-border dark:border-border-dark">
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: tab === t.key }}
            onPress={() => setTab(t.key)}
            className="flex-1 items-center pt-3 active:opacity-60">
            <Text className={tab === t.key ? 'font-bold text-ink dark:text-ink-dark' : 'text-muted dark:text-muted-dark'}>{t.label}</Text>
            <View className={`mt-3 h-1 w-14 rounded-full ${tab === t.key ? 'bg-primary dark:bg-primary-dark' : 'bg-transparent'}`} />
          </Pressable>
        ))}
      </View>
      {tab === 'todos' ? <BoardTodos boardId={id} /> : tab === 'notes' ? <BoardNotes boardId={id} /> : <BoardFiles boardId={id} />}
      <ActionSheet actions={menu} onClose={() => setMenu(null)} />
    </View>
  );
}
