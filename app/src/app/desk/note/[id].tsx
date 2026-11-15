import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { BoardPicker } from '@/components/desk/board-picker';
import { Comments } from '@/components/desk/comments';
import { Button, ErrorText } from '@/components/form';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import type { DeskComment, DeskNote } from '@/lib/desk';
import { createNote, deleteNote, fetchNote, updateNote } from '@/lib/desk-api';
import { showAlert } from '@/lib/dialog';
import { usePalette } from '@/theme/use-palette';

/**
 * A note on a board: a title and an optional description, then comments added over time, oldest first. `id` is "new"
 * for a note not written yet, on the board in `board`. ⋯ pins it, moves it to another board, or deletes it.
 */
export default function NoteScreen() {
  const { id, board: newOn } = useLocalSearchParams<{ id: string; board?: string }>();
  const isNew = id === 'new';
  const navigation = useNavigation();
  const palette = usePalette();
  const [note, setNote] = useState<DeskNote | null>(null);
  const [comments, setComments] = useState<DeskComment[]>([]);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState<SheetAction[] | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (isNew) return;
    fetchNote(id).then(
      (d) => {
        setNote(d.note);
        setComments(d.comments);
        setTitle(d.note.title);
        setDescription(d.note.description);
      },
      () => setMissing(true),
    );
  }, [id, isNew]);

  useEffect(() => {
    const change = (n: DeskNote, patch: { boardId?: string; pinned?: boolean }) =>
      updateNote(n.id, { boardId: patch.boardId ?? n.boardId, title: n.title, description: n.description, pinned: patch.pinned ?? n.pinned }).then(
        setNote,
        (e) => setError(describeError(e)),
      );
    navigation.setOptions({
      title: isNew ? 'New note' : 'Note',
      headerRight: note
        ? () => (
            <IconButton
              accessibilityLabel="Note options"
              onPress={() =>
                setMenu([
                  { label: note.pinned ? 'Unpin' : 'Pin to the top', onPress: () => change(note, { pinned: !note.pinned }) },
                  { label: 'Move to board…', onPress: () => setMoving(true) },
                  {
                    label: 'Delete note',
                    destructive: true,
                    onPress: () =>
                      showAlert('Delete this note?', 'Its comments are deleted too. This can’t be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteNote(note.id).then(() => router.back(), (e) => setError(describeError(e))) },
                      ]),
                  },
                ])
              }>
              <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
            </IconButton>
          )
        : undefined,
    });
  }, [navigation, note, isNew, palette.ink]);

  if (missing) {
    return (
      <View className="flex-1 bg-surface p-5 dark:bg-surface-dark">
        <Text className="text-muted dark:text-muted-dark">This note no longer exists.</Text>
      </View>
    );
  }
  if (!isNew && !note) return null;

  const dirty = isNew ? !!title.trim() : title !== note!.title || description !== note!.description;

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      if (isNew) {
        const created = await createNote({ boardId: newOn ?? '', title: title.trim(), description });
        router.replace({ pathname: '/desk/note/[id]', params: { id: created.id } });
      } else {
        setNote(await updateNote(note!.id, { boardId: note!.boardId, title: title.trim(), description }));
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="px-4 pb-10 pt-2">
        {note ? (
          <View className="flex-row items-center gap-1.5 pb-1">
            <Icon name="board-outline" size={14} color={palette.muted} />
            <Text className="text-[13px] text-muted dark:text-muted-dark">{note.boardName}</Text>
            {note.pinned ? <Text className="text-[13px] text-muted dark:text-muted-dark">· Pinned</Text> : null}
          </View>
        ) : null}
        <TextInput
          accessibilityLabel="Title"
          placeholder="Title"
          placeholderTextColor={palette.muted}
          value={title}
          onChangeText={(t) => setTitle(t.replace(/\n/g, ' '))}
          maxLength={200}
          autoCapitalize="sentences"
          autoFocus={isNew}
          className="py-2 text-xl font-bold text-ink dark:text-ink-dark"
        />
        <TextInput
          accessibilityLabel="Description"
          placeholder="Add a description (optional)"
          placeholderTextColor={palette.muted}
          value={description}
          onChangeText={setDescription}
          maxLength={50_000}
          multiline
          autoCapitalize="sentences"
          textAlignVertical="top"
          className="min-h-[120px] py-2 text-[16px] leading-6 text-ink dark:text-ink-dark"
        />
        <ErrorText>{error}</ErrorText>
        {dirty ? (
          <View className="items-end pt-2">
            <Button label={isNew ? 'Save note' : 'Save changes'} disabled={!title.trim()} loading={busy} onPress={save} />
          </View>
        ) : null}

        {note ? <Comments key={note.id} on="notes" id={note.id} initial={comments} /> : null}
      </ScrollView>
      <KeyboardSpacer />
      <ActionSheet actions={menu} onClose={() => setMenu(null)} />
      {note ? (
        <BoardPicker
          visible={moving}
          title="Move to board"
          current={note.boardId}
          onClose={() => setMoving(false)}
          onPick={(b) =>
            updateNote(note.id, { boardId: b.id, title: note.title, description: note.description }).then(setNote, (e) => setError(describeError(e)))
          }
        />
      ) : null}
    </View>
  );
}
