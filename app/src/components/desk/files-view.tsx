import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { IconButton } from '@/components/icon-button';
import { MediaImage } from '@/components/post-media';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { dayText, fileIcon, localDate, toAttachment, type DeskFile, type DeskListing } from '@/lib/desk';
import { createFolder, deleteFile, deleteFolder, fetchFolder, updateFile, updateFolder } from '@/lib/desk-api';
import { addDocuments, addFromLibrary } from '@/lib/desk-upload';
import { openViewer } from '@/lib/feed-store';
import { openLink } from '@/lib/links';
import { formatBytes } from '@/lib/storage-usage';
import { showToast } from '@/lib/toast';
import { openVideo } from '@/lib/video';
import { usePalette } from '@/theme/use-palette';

import { FolderPicker } from './folder-picker';
import { NameSheet } from './name-sheet';

type Folder = DeskListing['folders'][number];
type Item = { kind: 'folder'; folder: Folder } | { kind: 'file'; file: DeskFile };

const items = (n: number) => (n === 1 ? '1 item' : `${n} items`);

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

/** A level of my files: folders first, then files, with an add button for photos, documents and new folders. */
export function FilesView({ folderId, onLoaded }: { folderId: string | null; onLoaded?: (listing: DeskListing) => void }) {
  const palette = usePalette();
  const [listing, setListing] = useState<DeskListing | null>(null);
  const [error, setError] = useState<string>();
  const [pulling, setPulling] = useState(false);
  const [sheet, setSheet] = useState<{ title?: string; actions: SheetAction[] } | null>(null);
  const [naming, setNaming] = useState<{ title: string; initial: string; action: string; save: (name: string) => Promise<void> } | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const today = localDate();

  const load = useCallback(async () => {
    try {
      const l = await fetchFolder(folderId);
      setListing(l);
      onLoaded?.(l);
      setError(undefined);
    } catch {
      setError('Couldn’t load your files. Pull to try again.');
    }
  }, [folderId, onLoaded]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const add = async (pick: typeof addFromLibrary) => {
    try {
      const n = await pick(folderId, (done, total) => setUploading(total > 1 ? `Adding ${Math.min(done + 1, total)} of ${total}…` : 'Adding…'));
      if (n > 0) showToast(n === 1 ? 'Added' : `${n} files added`);
    } catch (e) {
      showAlert('Couldn’t add that', e instanceof Error && e.message.startsWith('Only') ? e.message : 'Check your connection and try again.');
    } finally {
      setUploading(null);
      load();
    }
  };

  const addMenu = () =>
    setSheet({
      title: 'Add to Files',
      actions: [
        { label: 'Photos or videos', onPress: () => add(addFromLibrary) },
        { label: 'Files', onPress: () => add(addDocuments) },
        {
          label: 'New folder',
          onPress: () =>
            setNaming({
              title: 'New folder',
              initial: '',
              action: 'Create folder',
              save: async (name) => {
                await createFolder(name, folderId);
                load();
              },
            }),
        },
      ],
    });

  const run = (job: () => Promise<unknown>, failed: string) => job().then(load, () => showAlert(failed, 'Check your connection and try again.'));

  const itemMenu = (item: Item) => {
    const name = item.kind === 'folder' ? item.folder.name : item.file.name;
    setSheet({
      title: name,
      actions: [
        {
          label: 'Rename',
          onPress: () =>
            setNaming({
              title: item.kind === 'folder' ? 'Rename folder' : 'Rename file',
              initial: name,
              action: 'Save',
              save: async (next) => {
                if (item.kind === 'folder') await updateFolder(item.folder.id, next, folderId);
                else await updateFile(item.file.id, next, folderId);
                load();
              },
            }),
        },
        { label: 'Move to…', onPress: () => setMoving(item) },
        {
          label: 'Delete',
          destructive: true,
          onPress: () =>
            showAlert(
              `Delete “${name}”?`,
              item.kind === 'folder' ? 'Everything in this folder is deleted too. This can’t be undone.' : 'This can’t be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => run(() => (item.kind === 'folder' ? deleteFolder(item.folder.id) : deleteFile(item.file.id)), 'Couldn’t delete'),
                },
              ],
            ),
        },
      ],
    });
  };

  const data: Item[] = listing ? [...listing.folders.map((f) => ({ kind: 'folder' as const, folder: f })), ...listing.files.map((f) => ({ kind: 'file' as const, file: f }))] : [];

  return (
    <View className="flex-1">
      {uploading ? (
        <View className="flex-row items-center gap-3 border-b border-border bg-surface-raised px-4 py-2 dark:border-border-dark dark:bg-surface-raised-dark">
          <Spinner />
          <Text className="text-[15px] text-ink dark:text-ink-dark">{uploading}</Text>
        </View>
      ) : null}
      <FlatList
        data={data}
        keyExtractor={(i) => (i.kind === 'folder' ? `d-${i.folder.id}` : `f-${i.file.id}`)}
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
          listing ? (
            <View className="h-[440px]">
              <EmptyState
                icon="folder-outline"
                title={folderId ? 'This folder is empty' : 'Keep files here'}
                body="PDFs, documents, photos and videos, in folders. They count towards your storage."
                actionLabel="Add files"
                onAction={addMenu}
              />
            </View>
          ) : undefined
        }
        renderItem={({ item }) => {
          const name = item.kind === 'folder' ? item.folder.name : item.file.name;
          return (
            <View className="flex-row items-center border-b border-border dark:border-border-dark">
              <Pressable
                accessibilityRole={item.kind === 'folder' ? 'link' : 'button'}
                onPress={() =>
                  item.kind === 'folder' ? router.push({ pathname: '/desk/folder/[id]', params: { id: item.folder.id } }) : openFile(item.file)
                }
                onLongPress={() => itemMenu(item)}
                className="flex-1 flex-row items-center gap-3 py-3 pl-4 active:bg-surface-raised dark:active:bg-surface-raised-dark">
                {item.kind === 'file' && item.file.previewUrl && item.file.previewKey ? (
                  <MediaImage objectKey={item.file.previewKey} url={item.file.previewUrl} className="h-10 w-10 rounded-md" />
                ) : (
                  <View className="h-10 w-10 items-center justify-center rounded-md bg-primary-soft dark:bg-primary-soft-dark">
                    <Icon name={item.kind === 'folder' ? 'folder-outline' : fileIcon(item.file)} size={22} color={palette.primary} />
                  </View>
                )}
                <View className="flex-1 gap-0.5">
                  <Text numberOfLines={1} className="text-[15px] font-semibold text-ink dark:text-ink-dark">
                    {name}
                  </Text>
                  <Text className="text-[13px] text-muted dark:text-muted-dark">
                    {item.kind === 'folder'
                      ? items(item.folder.items)
                      : `${formatBytes(item.file.sizeBytes)} · ${dayText(localDate(new Date(item.file.createdAt)), today)}`}
                  </Text>
                </View>
              </Pressable>
              <IconButton accessibilityLabel={`More for ${name}`} onPress={() => itemMenu(item)} className="mr-2">
                <Icon name="ellipsis-horizontal" size={20} color={palette.muted} />
              </IconButton>
            </View>
          );
        }}
      />
      <Fab accessibilityLabel="Add to Files" icon="add" onPress={addMenu} />
      <ActionSheet title={sheet?.title} actions={sheet?.actions ?? null} onClose={() => setSheet(null)} />
      <NameSheet
        visible={!!naming}
        title={naming?.title ?? ''}
        initial={naming?.initial ?? ''}
        actionLabel={naming?.action ?? 'Save'}
        maxLength={naming?.title.includes('file') ? 200 : 100}
        onClose={() => setNaming(null)}
        onSave={async (name) => naming?.save(name)}
      />
      <FolderPicker
        visible={!!moving}
        title={moving ? `Move “${moving.kind === 'folder' ? moving.folder.name : moving.file.name}”` : 'Move'}
        hide={moving?.kind === 'folder' ? moving.folder.id : undefined}
        onClose={() => setMoving(null)}
        onPick={(target) => {
          const item = moving;
          if (!item) return;
          run(
            () => (item.kind === 'folder' ? updateFolder(item.folder.id, item.folder.name, target) : updateFile(item.file.id, item.file.name, target)),
            'Couldn’t move that',
          );
        }}
      />
    </View>
  );
}
