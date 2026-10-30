/**
 * The current time, ticking every 30 s, for relative timestamps ("45s", "12m"). Pass it to `relativeTime` explicitly:
 * the React Compiler memoizes calls by their arguments, so `relativeTime(ms)` alone would never update.
 * One shared timer runs only while something is subscribed.
 */
import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
