import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { dayText, localDate, type DeskNoteSummary } from '@/lib/desk';
import { fetchNotes } from '@/lib/desk-api';
import { usePalette } from '@/theme/use-palette';

const openNote = (id: string) => router.push({ pathname: '/desk/note/[id]', params: { id } });

/** Notes, like a message board with one reader: pinned first, then the most recently changed. */
export function NotesSection() {
  const palette = usePalette();
  const [notes, setNotes] = useState<DeskNoteSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [pulling, setPulling] = useState(false);
  const today = localDate();

  const load = useCallback(async () => {
    try {
      setNotes(await fetchNotes());
      setError(undefined);
    } catch {
      setError('Couldn’t load your notes. Pull to try again.');
    }
  }, []);
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
            <View className="h-[440px]">
              <EmptyState
                icon="document-outline"
                title="Write things down"
                body="Ideas, plans, decisions, a journal. Add follow-ups to a note as things move on."
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
                {item.title || item.snippet || 'Note'}
              </Text>
              <Text className="text-[13px] text-muted dark:text-muted-dark">{dayText(localDate(new Date(item.updatedAt)), today)}</Text>
            </View>
            {item.title && item.snippet ? (
              <Text numberOfLines={2} className="text-[15px] leading-5 text-muted dark:text-muted-dark">
                {item.snippet}
              </Text>
            ) : null}
            {item.followups > 0 ? (
              <View className="flex-row items-center gap-1">
                <Icon name="chatbubble-outline" size={13} color={palette.muted} />
                <Text className="text-[13px] text-muted dark:text-muted-dark">
                  {item.followups === 1 ? '1 follow-up' : `${item.followups} follow-ups`}
                </Text>
              </View>
            ) : null}
          </Pressable>
        )}
      />
      <Fab accessibilityLabel="New note" icon="pencil-outline" onPress={() => openNote('new')} />
    </View>
  );
}
