import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { IconButton } from '@/components/icon-button';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import type { DeskComment } from '@/lib/desk';
import { addComment, deleteComment, type CommentsOn } from '@/lib/desk-api';
import { showAlert } from '@/lib/dialog';
import { fullTime } from '@/lib/time';
import { usePalette } from '@/theme/use-palette';

type Props = {
  on: CommentsOn;
  id: string;
  initial: DeskComment[];
  /** Told when comments are added or deleted, with how many there are now. */
  onCount?: (n: number) => void;
};

/**
 * Comments on a to-do, note or file: a running log, oldest first, of how things moved on (calls made, decisions, what
 * happened next). Only their owner sees them; the Desk is never shared. Long press deletes one.
 */
export function Comments({ on, id, initial, onCount }: Props) {
  const palette = usePalette();
  const [comments, setComments] = useState(initial);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const changed = (next: DeskComment[]) => {
    setComments(next);
    onCount?.(next.length);
  };

  const add = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      changed([...comments, await addComment(on, id, body)]);
      setDraft('');
    } catch {
      setError('Couldn’t add that. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (c: DeskComment) =>
    showAlert('Delete this comment?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteComment(c.id).then(
            () => changed(comments.filter((x) => x.id !== c.id)),
            () => setError('Couldn’t delete that. Check your connection and try again.'),
          ),
      },
    ]);

  return (
    <View className="mt-6 border-t border-border pt-4 dark:border-border-dark">
      <Text accessibilityRole="header" className="pb-2 text-lg font-extrabold text-ink dark:text-ink-dark">
        Comments
      </Text>
      {comments.length === 0 ? (
        <Text className="pb-2 text-[15px] text-muted dark:text-muted-dark">Keep track of how it’s going: calls made, decisions, what happened next.</Text>
      ) : null}
      {comments.map((c) => (
        <Pressable
          key={c.id}
          onLongPress={() => remove(c)}
          accessibilityHint="Long press to delete"
          className="gap-1 border-l-2 border-primary-soft py-2 pl-3 dark:border-primary-soft-dark">
          <Text className="text-[13px] text-muted dark:text-muted-dark">{fullTime(Date.parse(c.createdAt))}</Text>
          <Text className="text-[15px] leading-[21px] text-ink dark:text-ink-dark">{c.body}</Text>
        </Pressable>
      ))}
      {error ? <Text className="pt-2 text-sm text-danger dark:text-danger-dark">{error}</Text> : null}
      <View className="mt-3 flex-row items-end gap-2 rounded-2xl border border-border px-3 py-1 dark:border-border-dark">
        <TextInput
          accessibilityLabel="Add a comment"
          placeholder="Add a comment"
          placeholderTextColor={palette.muted}
          value={draft}
          onChangeText={setDraft}
          maxLength={5000}
          multiline
          autoCapitalize="sentences"
          className="max-h-32 flex-1 py-2 text-[15px] text-ink dark:text-ink-dark"
        />
        <IconButton accessibilityLabel="Post comment" onPress={add} className={draft.trim() ? 'bg-primary dark:bg-primary-dark' : 'opacity-40'}>
          <Icon name="arrow-up" size={18} color={draft.trim() ? palette.onPrimary : palette.muted} />
        </IconButton>
      </View>
    </View>
  );
}
