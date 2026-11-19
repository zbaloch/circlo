/**
 * Display (owner requests 2026-11-19): the colour mode, Light, Dark, or follow the device's setting (the default), and
 * which dark theme to use whenever the app is dark: Dark (near-black, the default) or Dim (classic Twitter's soft
 * navy). Settings of this device, like X's and Bluesky's, kept in device storage; they aren't sent to the server.
 */
import { useSyncExternalStore } from 'react';

import { applyDarkTheme, applyScheme } from '@/theme/color-scheme';

import { getItem, setItem } from './storage';

export type ThemeChoice = 'system' | 'light' | 'dark';

export type DarkTheme = 'dark' | 'dim';

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export const DARK_THEMES: { value: DarkTheme; label: string }[] = [
  { value: 'dim', label: 'Dim' },
  { value: 'dark', label: 'Dark' },
];

const KEY = 'circlo.theme';
const DARK_KEY = 'circlo.dark-theme';
let choice: ThemeChoice = 'system';
let darkTheme: DarkTheme = 'dark';
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

/** Pure: a stored dark theme, or the default (Dark) for anything else. */
export function parseDarkTheme(value: string | null | undefined): DarkTheme {
  return value === 'dim' ? 'dim' : 'dark';
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
    darkTheme = parseDarkTheme(await getItem(DARK_KEY));
  } catch {
    choice = 'system';
    darkTheme = 'dark';
  }
  applyScheme(choice);
  applyDarkTheme(darkTheme);
  loaded = true;
  emit();
}

export async function setTheme(next: ThemeChoice): Promise<void> {
  choice = next;
  applyScheme(next);
  emit();
  await setItem(KEY, next).catch(() => undefined);
}

export async function setDarkTheme(next: DarkTheme): Promise<void> {
  darkTheme = next;
  applyDarkTheme(next);
  emit();
  await setItem(DARK_KEY, next).catch(() => undefined);
}

export function useDarkTheme(): DarkTheme {
  return useSyncExternalStore(subscribe, () => darkTheme);
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => choice);
}

export function useThemeLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded);
}
