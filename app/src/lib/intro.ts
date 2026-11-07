/**
 * Whether this device has shown the intro screens. Kept only on the device (never sent anywhere): the first launch
 * starts the intro from the beginning, later ones open on its last screen, where Create account and Log in are.
 */
import { getItem, setItem } from './storage';

const KEY = 'circlo.intro-seen';
export const INTRO_LAST_PAGE = 3;

/** Pure: which screen the signed-out intro opens on. */
export function introStartPage(seen: boolean): number {
  return seen ? INTRO_LAST_PAGE : 0;
}

export async function introSeen(): Promise<boolean> {
  return (await getItem(KEY)) === '1';
}

export async function markIntroSeen(): Promise<void> {
  await setItem(KEY, '1').catch(() => undefined);
}
