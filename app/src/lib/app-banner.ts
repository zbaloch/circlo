/**
 * The web app's "Get Circlo for iPhone" banner. It shows only in the web app, only in a browser on an iPhone or iPad,
 * and only until it's closed. The browser's user agent is read on the device to decide this and is never sent
 * anywhere; closing it is remembered only on this device.
 */
import { getItem, setItem } from './storage';

const KEY = 'circlo.app-banner-closed';

export type AppBannerTarget = 'ios' | null;

/** Pure: which store's banner this browser should see, if any. */
export function appBannerTarget(opts: {
  enabled: boolean;
  os: string;
  userAgent: string;
  /** iPadOS Safari calls itself a Mac; a touch screen gives it away. */
  maxTouchPoints: number;
}): AppBannerTarget {
  if (!opts.enabled || opts.os !== 'web') return null;
  if (/iPhone|iPad|iPod/.test(opts.userAgent)) return 'ios';
  if (/Macintosh/.test(opts.userAgent) && opts.maxTouchPoints > 1) return 'ios';
  return null;
}

/** This browser, as appBannerTarget needs it (empty values when there is no browser). */
export function browserInfo(): { userAgent: string; maxTouchPoints: number } {
  const nav = (globalThis as { navigator?: { userAgent?: string; maxTouchPoints?: number } }).navigator;
  return { userAgent: nav?.userAgent ?? '', maxTouchPoints: nav?.maxTouchPoints ?? 0 };
}

export async function appBannerClosed(): Promise<boolean> {
  return (await getItem(KEY)) === '1';
}

export async function closeAppBanner(): Promise<void> {
  await setItem(KEY, '1').catch(() => undefined);
}
