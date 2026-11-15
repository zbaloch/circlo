import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { dayText, localDate, type DeskNoteSummary } from '@/lib/desk';
import { fetchBoardNotes } from '@/lib/desk-api';
import { usePalette } from '@/theme/use-palette';

/** A board's notes, like a message board with one reader: pinned first, then the most recently changed. */
export function BoardNotes({ boardId }: { boardId: string }) {
  const palette = usePalette();
  const [notes, setNotes] = useState<DeskNoteSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [pulling, setPulling] = useState(false);
  const today = localDate();

  const openNote = (id: string) => router.push({ pathname: '/desk/note/[id]', params: id === 'new' ? { id, board: boardId } : { id } });

  const load = useCallback(async () => {
    try {
      setNotes(await fetchBoardNotes(boardId));
      setError(undefined);
    } catch {
      setError('Couldn’t load the notes. Pull to try again.');
    }
  }, [boardId]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View className="flex-1">
      <FlatList
        data={notes ?? []}
        keyExtractor={(n) => n.id}
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
        contentContainerClassName="pb-28"
        ListHeaderComponent={error ? <Text className="px-4 py-2 text-center text-sm text-danger dark:text-danger-dark">{error}</Text> : undefined}
        ListEmptyComponent={
          notes ? (
            <View className="h-[400px]">
              <EmptyState
                icon="note-outline"
                title="Write things down"
                body="Ideas, plans, decisions, things to remember. Add comments as things move on."
                actionLabel="New note"
                onAction={() => openNote('new')}
              />
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            onPress={() => openNote(item.id)}
            className="gap-1 border-b border-border px-4 py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
            <View className="flex-row items-center gap-2">
              {item.pinned ? <Icon name="pin" size={14} color={palette.primary} accessibilityLabel="Pinned" /> : null}
              <Text numberOfLines={1} className="flex-1 text-[15px] font-bold text-ink dark:text-ink-dark">
                {item.title}
              </Text>
              <Text className="text-[13px] text-muted dark:text-muted-dark">{dayText(localDate(new Date(item.updatedAt)), today)}</Text>
            </View>
            {item.snippet ? (
              <Text numberOfLines={2} className="text-[15px] leading-5 text-muted dark:text-muted-dark">
                {item.snippet}
              </Text>
            ) : null}
            {item.commentCount > 0 ? (
              <View className="flex-row items-center gap-1">
                <Icon name="chatbubble-outline" size={13} color={palette.muted} />
                <Text className="text-[13px] text-muted dark:text-muted-dark">{item.commentCount === 1 ? '1 comment' : `${item.commentCount} comments`}</Text>
              </View>
            ) : null}
          </Pressable>
        )}
      />
      <Fab accessibilityLabel="New note" icon="pencil-outline" onPress={() => openNote('new')} />
    </View>
  );
}
