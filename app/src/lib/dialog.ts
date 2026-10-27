/**
 * In-app dialogs with the same call shape as React Native's Alert.alert, drawn by <DialogHost /> so they look the
 * same on iOS and Android (native alerts are Material dialogs on Android) and allow any number of buttons.
 */
import { useSyncExternalStore } from 'react';

export type DialogButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
export type Dialog = { title: string; message?: string; buttons: DialogButton[] };

let current: Dialog | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showAlert(title: string, message?: string, buttons?: DialogButton[]): void {
  current = { title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] };
  emit();
}

/** Closes the dialog, then runs the button's action (which may open another dialog). */
export function pressDialogButton(button: DialogButton): void {
  current = null;
  emit();
  button.onPress?.();
}

/** Back button / tap outside: acts like Cancel if there is one, otherwise like the only button. */
export function dismissDialog(): void {
  if (!current) return;
  const cancel = current.buttons.find((b) => b.style === 'cancel') ?? (current.buttons.length === 1 ? current.buttons[0] : undefined);
  if (cancel) pressDialogButton(cancel);
}

/** Buttons in display order: the actions first, Cancel last (as on X). Pure; exported for tests. */
export function orderedButtons(buttons: DialogButton[]): DialogButton[] {
  return [...buttons.filter((b) => b.style !== 'cancel'), ...buttons.filter((b) => b.style === 'cancel')];
}

export function useDialog(): Dialog | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
