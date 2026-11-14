import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { FilesView } from '@/components/desk/files-view';
import { FolderPicker } from '@/components/desk/folder-picker';
import { NameSheet } from '@/components/desk/name-sheet';
import { IconButton } from '@/components/icon-button';
import { Screen } from '@/components/screen';
import { Icon } from '@/components/ui/icon';
import type { DeskFolderRef, DeskListing } from '@/lib/desk';
import { deleteFolder, updateFolder } from '@/lib/desk-api';
import { showAlert } from '@/lib/dialog';
import { usePalette } from '@/theme/use-palette';

/** A folder of my Desk files. ⋯ renames, moves or deletes the folder (with everything in it). */
export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const palette = usePalette();
  const [folder, setFolder] = useState<DeskFolderRef | null>(null);
  const [menu, setMenu] = useState<SheetAction[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);

  const loaded = useCallback((l: DeskListing) => setFolder(l.folder ?? null), []);
  const failed = () => showAlert('Couldn’t change the folder', 'Check your connection and try again.');

  useEffect(() => {
    navigation.setOptions({
      title: folder?.name ?? 'Folder',
      headerRight: folder
        ? () => (
            <IconButton
              accessibilityLabel="Folder options"
              onPress={() =>
                setMenu([
                  { label: 'Rename folder', onPress: () => setRenaming(true) },
                  { label: 'Move folder to…', onPress: () => setMoving(true) },
                  {
                    label: 'Delete folder',
                    destructive: true,
                    onPress: () =>
                      showAlert(`Delete “${folder.name}”?`, 'Everything in this folder is deleted too. This can’t be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteFolder(folder.id).then(() => router.back(), failed) },
                      ]),
                  },
                ])
              }>
              <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
            </IconButton>
          )
        : undefined,
    });
  }, [navigation, folder, palette.ink]);

  return (
    <Screen>
      <FilesView folderId={id} onLoaded={loaded} />
      <ActionSheet actions={menu} onClose={() => setMenu(null)} />
      <NameSheet
        visible={renaming}
        title="Rename folder"
        initial={folder?.name ?? ''}
        actionLabel="Save"
        onClose={() => setRenaming(false)}
        onSave={async (name) => {
          if (folder) setFolder(await updateFolder(folder.id, name, folder.parentId ?? null));
        }}
      />
      <FolderPicker
        visible={moving}
        title={`Move “${folder?.name ?? ''}”`}
        hide={id}
        onClose={() => setMoving(false)}
        onPick={(target) => {
          if (folder) updateFolder(folder.id, folder.name, target).then(setFolder, failed);
        }}
      />
    </Screen>
  );
}
