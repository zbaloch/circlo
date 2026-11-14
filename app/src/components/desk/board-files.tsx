import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { MediaImage } from '@/components/post-media';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { dayText, fileIcon, localDate, toAttachment, type DeskFile } from '@/lib/desk';
import { fetchBoardFiles } from '@/lib/desk-api';
import { addDocuments, addFromLibrary } from '@/lib/desk-upload';
import { openViewer } from '@/lib/feed-store';
import { openLink } from '@/lib/links';
import { formatBytes } from '@/lib/storage-usage';
import { showToast } from '@/lib/toast';
import { openVideo } from '@/lib/video';
import { usePalette } from '@/theme/use-palette';

/** Opens a file: photos in the viewer, videos in the player, anything else in the browser (a link valid for an hour). */
export function openFile(file: DeskFile) {
  const media = toAttachment(file);
  if (media?.type === 'image') {
    openViewer([media], 0);
    router.push('/viewer');
  } else if (media?.type === 'video') {
    openVideo(media);
    router.push('/video');
  } else {
    openLink(file.url);
  }
}

/** A thumbnail for a photo or video, or an icon for its type. */
export function FileThumb({ file, size = 'h-10 w-10' }: { file: DeskFile; size?: string }) {
  const palette = usePalette();
  if (file.previewUrl && file.previewKey) return <MediaImage objectKey={file.previewKey} url={file.previewUrl} className={`${size} rounded-md`} />;
  return (
    <View className={`${size} items-center justify-center rounded-md bg-primary-soft dark:bg-primary-soft-dark`}>
      <Icon name={fileIcon(file)} size={22} color={palette.primary} />
    </View>
  );
}

/**
 * A board's files, newest first: documents, photos and videos, each with a title and an optional description. Tapping
 * one opens it, for its description and comments; + adds photos, videos or any other files.
 */
export function BoardFiles({ boardId, onChange }: { boardId: string; onChange?: () => void }) {
  const palette = usePalette();
  const [files, setFiles] = useState<DeskFile[] | null>(null);
  const [error, setError] = useState<string>();
  const [pulling, setPulling] = useState(false);
  const [menu, setMenu] = useState<SheetAction[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const today = localDate();

  const load = useCallback(async () => {
    try {
      setFiles(await fetchBoardFiles(boardId));
      setError(undefined);
    } catch {
      setError('Couldn’t load the files. Pull to try again.');
    }
  }, [boardId]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const add = async (pick: typeof addFromLibrary) => {
    try {
      const n = await pick(boardId, (done, total) => setUploading(total > 1 ? `Adding ${Math.min(done + 1, total)} of ${total}…` : 'Adding…'));
      if (n > 0) showToast(n === 1 ? 'Added' : `${n} files added`);
    } catch (e) {
      showAlert('Couldn’t add that', e instanceof Error && e.message.startsWith('Only') ? e.message : 'Check your connection and try again.');
    } finally {
      setUploading(null);
      load();
      onChange?.();
    }
  };

  const addMenu = () =>
    setMenu([
      { label: 'Photos or videos', onPress: () => add(addFromLibrary) },
      { label: 'Files', onPress: () => add(addDocuments) },
    ]);

  return (
    <View className="flex-1">
      {uploading ? (
        <View className="flex-row items-center gap-3 border-b border-border bg-surface-raised px-4 py-2 dark:border-border-dark dark:bg-surface-raised-dark">
          <Spinner />
          <Text className="text-[15px] text-ink dark:text-ink-dark">{uploading}</Text>
        </View>
      ) : null}
      <FlatList
        data={files ?? []}
        keyExtractor={(f) => f.id}
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
          files ? (
            <View className="h-[400px]">
              <EmptyState
                icon="document-outline"
                title="Keep files here"
                body="PDFs, documents, photos and videos. They count towards your storage."
                actionLabel="Add files"
                onAction={addMenu}
              />
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/desk/file/[id]', params: { id: item.id } })}
            className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
            <FileThumb file={item} />
            <View className="flex-1 gap-0.5">
              <Text numberOfLines={1} className="text-[15px] font-semibold text-ink dark:text-ink-dark">
                {item.title}
              </Text>
              {item.description ? (
                <Text numberOfLines={1} className="text-[14px] text-muted dark:text-muted-dark">
                  {item.description}
                </Text>
              ) : null}
              <View className="flex-row items-center gap-2">
                <Text className="text-[13px] text-muted dark:text-muted-dark">
                  {formatBytes(item.sizeBytes)} · {dayText(localDate(new Date(item.createdAt)), today)}
                </Text>
                {item.commentCount > 0 ? (
                  <View className="flex-row items-center gap-1">
                    <Icon name="chatbubble-outline" size={12} color={palette.muted} />
                    <Text className="text-[13px] text-muted dark:text-muted-dark">{item.commentCount}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        )}
      />
      <Fab accessibilityLabel="Add files" icon="add" onPress={addMenu} />
      <ActionSheet title="Add to Files" actions={menu} onClose={() => setMenu(null)} />
    </View>
  );
}
