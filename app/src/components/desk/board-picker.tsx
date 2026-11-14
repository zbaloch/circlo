import { useEffect, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';

import { Sheet } from '@/components/audience-sheet';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import type { DeskBoard } from '@/lib/desk';
import { fetchBoards } from '@/lib/desk-api';
import { usePalette } from '@/theme/use-palette';

type Props = {
  visible: boolean;
  title: string;
  /** The board it's on now, ticked. */
  current: string;
  onPick: (board: DeskBoard) => void;
  onClose: () => void;
};

/** Chooses a board to move a to-do, note or file to. */
export function BoardPicker(props: Props) {
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.title}>
      {/* Mounted only while open, so each opening shows the boards as they are now. */}
      {props.visible ? <Boards {...props} /> : null}
    </Sheet>
  );
}

function Boards({ current, onPick, onClose }: Props) {
  const palette = usePalette();
  const [boards, setBoards] = useState<DeskBoard[] | null>(null);

  useEffect(() => {
    let live = true;
    fetchBoards().then(
      (b) => live && setBoards(b),
      () => live && setBoards([]),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <ScrollView className="max-h-96">
      {!boards ? <Spinner className="py-6" /> : null}
      {(boards ?? []).map((b) => (
        <Pressable
          key={b.id}
          accessibilityRole="radio"
          accessibilityState={{ selected: b.id === current }}
          onPress={() => {
            onClose();
            if (b.id !== current) onPick(b);
          }}
          className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
          <Icon name="board-outline" size={22} color={palette.muted} />
          <Text className="flex-1 text-[15px] text-ink dark:text-ink-dark">{b.name}</Text>
          {b.id === current ? <Icon name="checkmark" size={20} color={palette.primary} /> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}
