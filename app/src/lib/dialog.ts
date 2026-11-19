/**
 * In-app dialogs with the same call shape as React Native's Alert.alert, drawn by <DialogHost /> so they look the
 * same on iOS and Android (native alerts are Material dialogs on Android) and allow any number of buttons.
 *
 * The app has one host at its root, and a bottom sheet (itself a Modal) can hold its own inline host: the newest
 * host shows the dialog. A dialog opened from a sheet then appears inside the sheet's window, instead of as a
 * second Modal stacked under or over it, which could leave an invisible layer that swallows every tap.
 */
import { useSyncExternalStore } from 'react';

export type DialogButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
export type Dialog = { title: string; message?: string; buttons: DialogButton[] };

let current: Dialog | null = null;
const listeners = new Set<() => void>();
/** Mounted hosts, oldest first; the last one shows the dialog. */
const hosts: symbol[] = [];

/** Adds a host (on mount); returns the function that removes it (on unmount). */
export function registerDialogHost(host: symbol): () => void {
  hosts.push(host);
  emit();
  return () => {
    const i = hosts.lastIndexOf(host);
    if (i >= 0) hosts.splice(i, 1);
    emit();
  };
}

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

/** Whether a dialog is showing (a sheet's back button closes it first). */
export function dialogOpen(): boolean {
  return current !== null;
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

/** The dialog for this host to draw: the current one if it's the newest host, otherwise null. */
export function useDialog(host: symbol): Dialog | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (hosts[hosts.length - 1] === host ? current : null),
  );
}
