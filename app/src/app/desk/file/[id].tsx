import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { FileThumb, openFile } from '@/components/desk/board-files';
import { BoardPicker } from '@/components/desk/board-picker';
import { Comments } from '@/components/desk/comments';
import { Button, ErrorText } from '@/components/form';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { MediaImage } from '@/components/post-media';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { dayText, localDate, type DeskComment, type DeskFile } from '@/lib/desk';
import { deleteFile, fetchFile, updateFile } from '@/lib/desk-api';
import { showAlert } from '@/lib/dialog';
import { formatBytes } from '@/lib/storage-usage';
import { usePalette } from '@/theme/use-palette';

/**
 * A file on a board: a preview (tap to open it), its title and optional description, and comments. ⋯ moves it to
 * another board or deletes it.
 */
export default function FileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const palette = usePalette();
  const [file, setFile] = useState<DeskFile | null>(null);
  const [comments, setComments] = useState<DeskComment[]>([]);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState<SheetAction[] | null>(null);
  const [moving, setMoving] = useState(false);
  const today = localDate();

  useEffect(() => {
    fetchFile(id).then(
      (d) => {
        setFile(d.file);
        setComments(d.comments);
        setTitle(d.file.title);
        setDescription(d.file.description);
      },
      () => setMissing(true),
    );
  }, [id]);

  useEffect(() => {
    navigation.setOptions({
      title: 'File',
      headerRight: file
        ? () => (
            <IconButton
              accessibilityLabel="File options"
              onPress={() =>
                setMenu([
                  { label: 'Open', onPress: () => openFile(file) },
                  { label: 'Move to board…', onPress: () => setMoving(true) },
                  {
                    label: 'Delete file',
                    destructive: true,
                    onPress: () =>
                      showAlert(`Delete “${file.title}”?`, 'Its comments are deleted too. This can’t be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteFile(file.id).then(() => router.back(), (e) => setError(describeError(e))) },
                      ]),
                  },
                ])
              }>
              <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
            </IconButton>
          )
        : undefined,
    });
  }, [navigation, file, palette.ink]);

  if (missing) {
    return (
      <View className="flex-1 bg-surface p-5 dark:bg-surface-dark">
        <Text className="text-muted dark:text-muted-dark">This file no longer exists.</Text>
      </View>
    );
  }
  if (!file) return null;

  const dirty = title !== file.title || description !== file.description;
  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await updateFile(file.id, { boardId: file.boardId, title: title.trim(), description });
      setFile(saved);
      setTitle(saved.title);
      setDescription(saved.description);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const media = file.kind !== 'file' && file.previewKey && file.previewUrl;
  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="px-4 pb-10 pt-3">
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${file.fileName}`} onPress={() => openFile(file)} className="active:opacity-80">
          {media ? (
            <View>
              <MediaImage objectKey={file.previewKey!} url={file.previewUrl!} className="aspect-video w-full rounded-xl" />
              {file.kind === 'video' ? (
                <View className="absolute inset-0 items-center justify-center">
                  <View className="h-14 w-14 items-center justify-center rounded-full bg-black/60">
                    <Icon name="play" size={28} color="#FFFFFF" />
                  </View>
                </View>
              ) : null}
            </View>
          ) : (
            <View className="flex-row items-center gap-3 rounded-xl border border-border p-3 dark:border-border-dark">
              <FileThumb file={file} size="h-12 w-12" />
              <View className="flex-1">
                <Text numberOfLines={2} className="text-[15px] font-semibold text-ink dark:text-ink-dark">{file.fileName}</Text>
                <Text className="text-[13px] text-muted dark:text-muted-dark">{formatBytes(file.sizeBytes)}</Text>
              </View>
              <Text className="text-[15px] font-semibold text-primary dark:text-primary-dark">Open</Text>
            </View>
          )}
        </Pressable>
        <View className="flex-row flex-wrap items-center gap-x-1.5 pt-3">
          <Icon name="board-outline" size={14} color={palette.muted} />
          <Text className="text-[13px] text-muted dark:text-muted-dark">
            {file.boardName} · Added {dayText(localDate(new Date(file.createdAt)), today)}
            {media ? ` · ${formatBytes(file.sizeBytes)}` : ''}
          </Text>
        </View>
        <TextInput
          accessibilityLabel="Title"
          placeholder="Title"
          placeholderTextColor={palette.muted}
          value={title}
          onChangeText={(t) => setTitle(t.replace(/\n/g, ' '))}
          maxLength={200}
          autoCapitalize="sentences"
          className="py-2 text-xl font-bold text-ink dark:text-ink-dark"
        />
        <TextInput
          accessibilityLabel="Description"
          placeholder="Add a description (optional)"
          placeholderTextColor={palette.muted}
          value={description}
          onChangeText={setDescription}
          maxLength={10_000}
          multiline
          autoCapitalize="sentences"
          textAlignVertical="top"
          className="min-h-[60px] py-2 text-[15px] leading-[21px] text-ink dark:text-ink-dark"
        />
        <ErrorText>{error}</ErrorText>
        {dirty ? (
          <View className="items-end pt-2">
            <Button label="Save changes" disabled={!title.trim()} loading={busy} onPress={save} />
          </View>
        ) : null}

        <Comments key={file.id} on="files" id={file.id} initial={comments} />
      </ScrollView>
      <KeyboardSpacer />
      <ActionSheet actions={menu} onClose={() => setMenu(null)} />
      <BoardPicker
        visible={moving}
        title="Move to board"
        current={file.boardId}
        onClose={() => setMoving(false)}
        onPick={(b) => updateFile(file.id, { boardId: b.id, title: file.title, description: file.description }).then(setFile, (e) => setError(describeError(e)))}
      />
    </View>
  );
}
