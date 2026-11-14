import { useState } from 'react';
import { View } from 'react-native';

import { Sheet } from '@/components/audience-sheet';
import { Button, ErrorText, TextField } from '@/components/form';
import { describeError } from '@/lib/account';

type Props = {
  visible: boolean;
  title: string;
  label?: string;
  initial?: string;
  actionLabel: string;
  maxLength?: number;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
};

/** Asks for a name (a new list or folder, or renaming one): a text field and one button. */
export function NameSheet(props: Props) {
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.title}>
      {/* Mounted only while open, so each opening starts from `initial`. */}
      {props.visible ? <NameForm {...props} /> : null}
    </Sheet>
  );
}

function NameForm({ label = 'Name', initial = '', actionLabel, maxLength = 100, onSave, onClose }: Props) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSave(name.trim());
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-4 px-5 pb-4 pt-2">
      <TextField label={label} value={name} onChangeText={setName} maxLength={maxLength} autoFocus autoCapitalize="sentences" returnKeyType="done" onSubmitEditing={save} />
      <ErrorText>{error}</ErrorText>
      <Button label={actionLabel} disabled={!name.trim()} loading={busy} onPress={save} />
    </View>
  );
}
