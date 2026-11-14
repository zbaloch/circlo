import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Sheet } from '@/components/audience-sheet';
import { Button } from '@/components/form';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import type { DeskListing } from '@/lib/desk';
import { fetchFolder } from '@/lib/desk-api';
import { usePalette } from '@/theme/use-palette';

type Props = {
  visible: boolean;
  title: string;
  hide?: string;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
};

/**
 * Chooses where to move a file or folder: start at the top level, open folders to go in, Back to go up, then "Move
 * here". `hide` is the folder being moved, so it can't be opened or chosen as its own destination.
 */
export function FolderPicker(props: Props) {
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.title}>
      {/* Mounted only while open, so each move starts at the top level. */}
      {props.visible ? <Browser {...props} /> : null}
    </Sheet>
  );
}

function Browser({ hide, onPick, onClose }: Props) {
  const palette = usePalette();
  const [at, setAt] = useState<string | null>(null);
  // The listing of the folder last loaded; while another one loads, nothing is shown.
  const [loaded, setLoaded] = useState<{ at: string | null; listing: DeskListing } | null>(null);
  const listing = loaded && loaded.at === at ? loaded.listing : null;

  useEffect(() => {
    let live = true;
    fetchFolder(at).then(
      (l) => live && setLoaded({ at, listing: l }),
      () => live && setLoaded({ at, listing: { folder: null, path: [], folders: [], files: [] } }),
    );
    return () => {
      live = false;
    };
  }, [at]);

  const here = listing?.folder ?? null;
  return (
    <>
      <View className="flex-row items-center gap-2 px-5 pb-2">
        {here ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={() => setAt(here.parentId ?? null)}>
            <Icon name="arrow-back" size={20} color={palette.ink} />
          </Pressable>
        ) : null}
        <Text numberOfLines={1} className="flex-1 text-[15px] font-semibold text-muted dark:text-muted-dark">
          {here ? here.name : 'Files'}
        </Text>
      </View>
      <ScrollView className="max-h-80">
        {!listing ? <Spinner className="py-6" /> : null}
        {listing && listing.folders.filter((f) => f.id !== hide).length === 0 ? (
          <Text className="px-5 py-3 text-[15px] text-muted dark:text-muted-dark">No folders in here.</Text>
        ) : null}
        {(listing?.folders ?? [])
          .filter((f) => f.id !== hide)
          .map((f) => (
            <Pressable key={f.id} accessibilityRole="button" onPress={() => setAt(f.id)} className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
              <Icon name="folder-outline" size={22} color={palette.muted} />
              <Text className="flex-1 text-[15px] text-ink dark:text-ink-dark">{f.name}</Text>
              <Icon name="chevron-forward" size={18} color={palette.muted} />
            </Pressable>
          ))}
      </ScrollView>
      <View className="px-5 pt-3">
        <Button
          label={here ? `Move to ${here.name}` : 'Move to the top level'}
          disabled={!listing}
          onPress={() => {
            onClose();
            onPick(here?.id ?? null);
          }}
        />
      </View>
    </>
  );
}
