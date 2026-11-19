/**
 * Display (owner request 2026-11-19): Light, Dark, or follow the phone's setting (the default). A setting of this
 * device, like X's display options, kept in device storage; it isn't sent to the server.
 */
import { useSyncExternalStore } from 'react';

import { applyScheme } from '@/theme/color-scheme';

import { getItem, setItem } from './storage';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'Follow your device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const KEY = 'circlo.theme';
let choice: ThemeChoice = 'system';
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Pure: a stored value, or the default for anything else. */
export function parseTheme(value: string | null | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Pure: what the screens show for this choice when the device is in `system` mode. */
export function resolveScheme(c: ThemeChoice, system: string | null | undefined): 'light' | 'dark' {
  if (c !== 'system') return c;
  return system === 'dark' ? 'dark' : 'light';
}

/** Reads the saved choice and applies it; the app keeps its splash screen up until this is done. */
export async function loadTheme(): Promise<void> {
  try {
    choice = parseTheme(await getItem(KEY));
  } catch {
    choice = 'system';
  }
  applyScheme(choice);
  loaded = true;
  emit();
}

export async function setTheme(next: ThemeChoice): Promise<void> {
  choice = next;
  applyScheme(next);
  emit();
  await setItem(KEY, next).catch(() => undefined);
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => choice);
}

export function useThemeLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded);
}
