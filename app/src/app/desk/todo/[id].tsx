import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { BoardPicker } from '@/components/desk/board-picker';
import { Comments } from '@/components/desk/comments';
import { DateSheet } from '@/components/desk/date-sheet';
import { Button, ErrorText } from '@/components/form';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Icon } from '@/components/ui/icon';
import { Text, TextInput } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { addDays, dayText, dueLabel, localDate, type DeskRepeat } from '@/lib/desk';
import { deleteTodo, fetchTodo, updateTodo, type TodoDetail } from '@/lib/desk-api';
import { showAlert } from '@/lib/dialog';
import { usePalette } from '@/theme/use-palette';

type Kind = DeskRepeat['kind'] | 'none';
const REPEATS: { kind: Kind; label: string; unit?: string }[] = [
  { kind: 'none', label: 'Doesn’t repeat' },
  { kind: 'daily', label: 'Every day', unit: 'day' },
  { kind: 'weekdays', label: 'Every weekday' },
  { kind: 'weekly', label: 'Every week', unit: 'week' },
  { kind: 'monthly', label: 'Every month', unit: 'month' },
  { kind: 'yearly', label: 'Every year', unit: 'year' },
  { kind: 'after', label: 'Days after it’s done', unit: 'day' },
];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-full border px-3 py-1.5 ${selected ? 'border-primary bg-primary-soft dark:border-primary-dark dark:bg-primary-soft-dark' : 'border-border dark:border-border-dark'}`}>
      <Text className={`text-[15px] ${selected ? 'font-semibold text-primary dark:text-primary-dark' : 'text-ink dark:text-ink-dark'}`}>{label}</Text>
    </Pressable>
  );
}

function Label({ children }: { children: string }) {
  return <Text className="pb-2 pt-5 text-sm font-semibold text-ink dark:text-ink-dark">{children}</Text>;
}

/**
 * One to-do: its title and description, when it's due, how it repeats, which board it's on, when it was done before,
 * and comments.
 */
export default function TodoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const today = localDate();
  const [detail, setDetail] = useState<TodoDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('none');
  const [every, setEvery] = useState(1);
  const [board, setBoard] = useState({ id: '', name: '' });
  const [picking, setPicking] = useState(false);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetchTodo(id).then(
      (d) => {
        const t = d.todo;
        setDetail(d);
        setTitle(t.title);
        setDescription(t.description);
        setDue(t.dueDate ?? null);
        setKind(t.repeat?.kind ?? 'none');
        setEvery(t.repeat?.every ?? 1);
        setBoard({ id: t.boardId, name: t.boardName });
      },
      () => setMissing(true),
    );
  }, [id]);

  if (missing) {
    return (
      <View className="flex-1 bg-surface p-5 dark:bg-surface-dark">
        <Text className="text-muted dark:text-muted-dark">This to-do no longer exists.</Text>
      </View>
    );
  }
  if (!detail) return null;
  const todo = detail.todo;

  const repeat = REPEATS.find((r) => r.kind === kind)!;
  const chooseRepeat = (k: Kind) => {
    setKind(k);
    setEvery(k === 'after' ? 7 : 1);
  };

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // A scheduled repeat counts from its due date: today unless one is chosen.
      const dueDate = kind !== 'none' && kind !== 'after' && !due ? today : due;
      await updateTodo(id, { boardId: board.id, title: title.trim(), description, dueDate, repeat: kind === 'none' ? null : { kind, every: kind === 'weekdays' ? 1 : every } });
      router.back();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    showAlert('Delete this to-do?', todo.repeat ? 'It won’t come back again.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTodo(id).then(() => router.back(), (e) => setError(describeError(e))) },
    ]);

  const customDue = due && ![today, addDays(today, 1), addDays(today, 7)].includes(due);
  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="px-4 pb-10 pt-2">
        <TextInput
          accessibilityLabel="Title"
          value={title}
          onChangeText={setTitle}
          maxLength={500}
          multiline
          autoCapitalize="sentences"
          className="py-2 text-xl font-bold text-ink dark:text-ink-dark"
        />
        <TextInput
          accessibilityLabel="Description"
          placeholder="Add a description"
          placeholderTextColor={palette.muted}
          value={description}
          onChangeText={setDescription}
          maxLength={10_000}
          multiline
          autoCapitalize="sentences"
          className="min-h-[60px] py-2 text-[15px] text-ink dark:text-ink-dark"
        />

        <Label>Due</Label>
        <View className="flex-row flex-wrap gap-2">
          <Chip label="No date" selected={!due} onPress={() => setDue(null)} />
          <Chip label="Today" selected={due === today} onPress={() => setDue(today)} />
          <Chip label="Tomorrow" selected={due === addDays(today, 1)} onPress={() => setDue(addDays(today, 1))} />
          <Chip label="In a week" selected={due === addDays(today, 7)} onPress={() => setDue(addDays(today, 7))} />
          <Chip label={customDue ? dayText(due, today) : 'Pick a date'} selected={!!customDue} onPress={() => setPicking(true)} />
        </View>

        <Label>Repeat</Label>
        <View className="flex-row flex-wrap gap-2">
          {REPEATS.map((r) => (
            <Chip key={r.kind} label={r.label} selected={kind === r.kind} onPress={() => chooseRepeat(r.kind)} />
          ))}
        </View>
        {repeat.unit ? (
          <View className="flex-row items-center gap-3 pt-3">
            <Text className="text-[15px] text-ink dark:text-ink-dark">{kind === 'after' ? 'Come back' : 'Every'}</Text>
            <IconButton accessibilityLabel="Fewer" onPress={() => setEvery(Math.max(1, every - 1))} className="border border-border dark:border-border-dark">
              <Icon name="chevron-back" size={18} color={palette.ink} />
            </IconButton>
            <Text className="min-w-8 text-center text-base font-bold text-ink dark:text-ink-dark">{every}</Text>
            <IconButton accessibilityLabel="More" onPress={() => setEvery(Math.min(365, every + 1))} className="border border-border dark:border-border-dark">
              <Icon name="chevron-forward" size={18} color={palette.ink} />
            </IconButton>
            <Text className="flex-1 text-[15px] text-ink dark:text-ink-dark">
              {every === 1 ? repeat.unit : `${repeat.unit}s`}
              {kind === 'after' ? ' after it’s done' : ''}
            </Text>
          </View>
        ) : null}

        <Label>Board</Label>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Board: ${board.name}. Change`}
          onPress={() => setMoving(true)}
          className="flex-row items-center gap-3 rounded-xl border border-border px-3 py-2.5 active:opacity-60 dark:border-border-dark">
          <Icon name="board-outline" size={20} color={palette.muted} />
          <Text className="flex-1 text-[15px] text-ink dark:text-ink-dark">{board.name}</Text>
          <Text className="text-[15px] font-semibold text-primary dark:text-primary-dark">Change</Text>
        </Pressable>

        <View className="gap-3 pt-6">
          <ErrorText>{error}</ErrorText>
          <Button label="Save" disabled={!title.trim()} loading={busy} onPress={save} />
          <Button label="Delete to-do" variant="outline" onPress={remove} />
        </View>

        {detail.history.length > 0 ? (
          <>
            <Label>Done before</Label>
            {detail.history.map((h) => (
              <View key={h.id} className="flex-row items-center gap-2 py-1">
                <Icon name="checkmark-circle" size={16} color={palette.primary} />
                <Text className="text-[15px] text-muted dark:text-muted-dark">
                  {h.doneAt ? dayText(localDate(new Date(h.doneAt)), today) : ''}
                  {h.dueDate && h.doneAt && dueLabel(h.dueDate, localDate(new Date(h.doneAt)))?.late ? ' (late)' : ''}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        <Comments on="todos" id={todo.id} initial={detail.comments} />
      </ScrollView>
      <KeyboardSpacer />
      <DateSheet visible={picking} value={due} today={today} onPick={setDue} onClose={() => setPicking(false)} />
      <BoardPicker
        visible={moving}
        title="Move to board"
        current={board.id}
        onClose={() => setMoving(false)}
        onPick={(b) => setBoard({ id: b.id, name: b.name })}
      />
    </View>
  );
}
