/**
 * Short confirmations at the bottom of the screen, X style ("Reply sent · View"), drawn by <ToastHost />. One at a
 * time: a new toast replaces the current one. Each hides itself after a few seconds.
 */
import { useSyncExternalStore } from 'react';

export type ToastAction = { text: string; onPress: () => void };
export type Toast = { id: number; message: string; action?: ToastAction };

export const TOAST_MS = 4000;

let current: Toast | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showToast(message: string, action?: ToastAction): void {
  clearTimeout(timer);
  current = { id: nextId++, message, action };
  emit();
  timer = setTimeout(hideToast, TOAST_MS);
}

export function hideToast(): void {
  clearTimeout(timer);
  if (!current) return;
  current = null;
  emit();
}

/** Hides the toast, then runs its action. */
export function pressToastAction(toast: Toast): void {
  hideToast();
  toast.action?.onPress();
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
