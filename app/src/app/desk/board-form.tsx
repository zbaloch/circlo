import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, ErrorText, TextField } from '@/components/form';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Spinner } from '@/components/ui/spinner';
import { describeError } from '@/lib/account';
import { createBoard, fetchBoard, updateBoard } from '@/lib/desk-api';

/**
 * A new board, or editing one (`id`): its name and an optional description. A full screen rather than a sheet, so the
 * fields stay above the keyboard.
 */
export default function BoardFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const navigation = useNavigation();
  const [loaded, setLoaded] = useState(!id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    navigation.setOptions({ title: id ? 'Edit board' : 'New board' });
  }, [navigation, id]);

  useEffect(() => {
    if (!id) return;
    fetchBoard(id).then(
      (b) => {
        setName(b.name);
        setDescription(b.description);
        setLoaded(true);
      },
      (e) => {
        setError(describeError(e));
        setLoaded(true);
      },
    );
  }, [id]);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (id) {
        await updateBoard(id, { name: name.trim(), description });
        router.back();
      } else {
        const b = await createBoard({ name: name.trim(), description });
        router.replace({ pathname: '/desk/board/[id]', params: { id: b.id } });
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Spinner className="flex-1 bg-surface dark:bg-surface-dark" />;

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-10 pt-4">
        <TextField
          label="Name"
          placeholder="Home renovation, Taxes 2026, a trip…"
          value={name}
          onChangeText={(t) => setName(t.replace(/\n/g, ' '))}
          maxLength={100}
          autoFocus={!id}
          autoCapitalize="sentences"
          autoCorrect
          returnKeyType="next"
        />
        <TextField
          label="Description (optional)"
          placeholder="What this board is for"
          value={description}
          onChangeText={setDescription}
          maxLength={10_000}
          multiline
          autoCapitalize="sentences"
          autoCorrect
          textAlignVertical="top"
          className="min-h-[120px] rounded-lg border border-border px-4 py-3 text-[15px] leading-[21px] text-ink focus:border-primary dark:border-border-dark dark:text-ink-dark"
        />
        <ErrorText>{error}</ErrorText>
        <Button label={id ? 'Save' : 'Create board'} disabled={!name.trim()} loading={busy} onPress={save} />
      </ScrollView>
      <KeyboardSpacer />
    </View>
  );
}
