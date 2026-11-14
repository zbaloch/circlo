import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Button, ErrorText } from '@/components/form';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { type DeskNote } from '@/lib/desk';
import { addFollowup, createNote, deleteFollowup, deleteNote, fetchNote, updateNote } from '@/lib/desk-api';
import { showAlert } from '@/lib/dialog';
import { fullTime } from '@/lib/time';
import { usePalette } from '@/theme/use-palette';

/**
 * A note: a title and a body, then follow-ups added over time, oldest first (a running log of how things moved on).
 * `id` is "new" for a note not written yet. ⋯ pins or deletes it.
 */
export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const navigation = useNavigation();
  const palette = usePalette();
  const [note, setNote] = useState<DeskNote | null>(null);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [followup, setFollowup] = useState('');
  const [busy, setBusy] = useState<'save' | 'followup' | null>(null);
  const [error, setError] = useState<string>();
  const [menu, setMenu] = useState<SheetAction[] | null>(null);

  useEffect(() => {
    if (isNew) return;
    fetchNote(id).then(
      (n) => {
        setNote(n);
        setTitle(n.title);
        setBody(n.body);
      },
      () => setMissing(true),
    );
  }, [id, isNew]);

  useEffect(() => {
    navigation.setOptions({
      title: isNew ? 'New note' : 'Note',
      headerRight: note
        ? () => (
            <IconButton
              accessibilityLabel="Note options"
              onPress={() =>
                setMenu([
                  {
                    label: note.pinned ? 'Unpin' : 'Pin to the top',
                    onPress: () => updateNote(note.id, { title: note.title, body: note.body, pinned: !note.pinned }).then(setNote, (e) => setError(describeError(e))),
                  },
                  {
                    label: 'Delete note',
                    destructive: true,
                    onPress: () =>
                      showAlert('Delete this note?', 'Its follow-ups are deleted too. This can’t be undone.', [
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

  const dirty = isNew ? !!(title.trim() || body.trim()) : title !== note!.title || body !== note!.body;

  const save = async () => {
    setBusy('save');
    setError(undefined);
    try {
      if (isNew) {
        const created = await createNote(title.trim(), body);
        router.replace({ pathname: '/desk/note/[id]', params: { id: created.id } });
      } else {
        setNote(await updateNote(note!.id, { title: title.trim(), body }));
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const addOne = async () => {
    const text = followup.trim();
    if (!text || !note || busy) return;
    setBusy('followup');
    try {
      const f = await addFollowup(note.id, text);
      setNote({ ...note, followups: [...note.followups, f] });
      setFollowup('');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const removeFollowup = (fid: string) =>
    showAlert('Delete this follow-up?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteFollowup(note!.id, fid).then(
            () => setNote((n) => (n ? { ...n, followups: n.followups.filter((f) => f.id !== fid) } : n)),
            (e) => setError(describeError(e)),
          ),
      },
    ]);

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="px-4 pb-10 pt-2">
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
          accessibilityLabel="Note"
          placeholder="Write something…"
          placeholderTextColor={palette.muted}
          value={body}
          onChangeText={setBody}
          maxLength={50_000}
          multiline
          autoCapitalize="sentences"
          textAlignVertical="top"
          className="min-h-[160px] py-2 text-[16px] leading-6 text-ink dark:text-ink-dark"
        />
        <ErrorText>{error}</ErrorText>
        {dirty ? (
          <View className="items-end pt-2">
            <Button label={isNew ? 'Save note' : 'Save changes'} loading={busy === 'save'} onPress={save} />
          </View>
        ) : null}

        {note ? (
          <View className="mt-6 border-t border-border pt-4 dark:border-border-dark">
            <Text accessibilityRole="header" className="pb-2 text-lg font-extrabold text-ink dark:text-ink-dark">
              Follow-ups
            </Text>
            {note.followups.length === 0 ? (
              <Text className="pb-2 text-[15px] text-muted dark:text-muted-dark">Add how things move on: calls made, decisions, what happened next.</Text>
            ) : null}
            {note.followups.map((f) => (
              <Pressable key={f.id} onLongPress={() => removeFollowup(f.id)} accessibilityHint="Long press to delete" className="gap-1 border-l-2 border-primary-soft py-2 pl-3 dark:border-primary-soft-dark">
                <Text className="text-[13px] text-muted dark:text-muted-dark">{fullTime(Date.parse(f.createdAt))}</Text>
                <Text className="text-[15px] leading-[21px] text-ink dark:text-ink-dark">{f.body}</Text>
              </Pressable>
            ))}
            <View className="mt-3 flex-row items-end gap-2 rounded-2xl border border-border px-3 py-1 dark:border-border-dark">
              <TextInput
                accessibilityLabel="Add a follow-up"
                placeholder="Add a follow-up"
                placeholderTextColor={palette.muted}
                value={followup}
                onChangeText={setFollowup}
                maxLength={5000}
                multiline
                autoCapitalize="sentences"
                className="max-h-32 flex-1 py-2 text-[15px] text-ink dark:text-ink-dark"
              />
              <IconButton accessibilityLabel="Add follow-up" onPress={addOne} className={followup.trim() ? 'bg-primary dark:bg-primary-dark' : 'opacity-40'}>
                <Icon name="arrow-up" size={18} color={followup.trim() ? palette.onPrimary : palette.muted} />
              </IconButton>
            </View>
          </View>
        ) : null}
      </ScrollView>
      <KeyboardSpacer />
      <ActionSheet actions={menu} onClose={() => setMenu(null)} />
    </View>
  );
}
