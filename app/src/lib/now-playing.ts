import { useSyncExternalStore } from 'react';

/**
 * The video playing now, shared across screens (owner request 2026-11-08): one video at a time, and it carries on
 * where you are. Each place a video is shown is an "owner" (a number). Leaving a screen hands the video on with its
 * position (owner 0), and the next place showing that video, such as the post you opened or Home when you come back,
 * picks it up from there, playing or paused as it was. Starting another video takes over, and the first one pauses.
 */
export type NowPlaying = { key: string; owner: number; time: number; playing: boolean } | null;

let state: NowPlaying = null;
const listeners = new Set<() => void>();
let nextOwner = 1;

function set(next: NowPlaying) {
  state = next;
  listeners.forEach((l) => l());
}

export function nowPlaying(): NowPlaying {
  return state;
}

export function newOwner(): number {
  return nextOwner++;
}

/** `owner` is showing and playing `key` now; any other video stops being the one playing. */
export function claim(key: string, owner: number, time?: number) {
  const keep = state?.key === key ? state.time : 0;
  set({ key, owner, time: time ?? keep, playing: true });
}

/** `owner` stops showing `key` (its screen lost focus, or it went away): hand it on, with where it got to. */
export function release(key: string, owner: number, time: number, playing: boolean) {
  if (state?.key !== key || state.owner !== owner) return;
  set({ key, owner: 0, time, playing });
}

/** Played or paused with the controls, by whoever is showing it. */
export function setPlaying(key: string, owner: number, playing: boolean) {
  if (state?.key !== key || state.owner !== owner || state.playing === playing) return;
  set({ ...state, playing });
}

export function useNowPlaying(): NowPlaying {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** For tests. */
export function resetNowPlaying() {
  state = null;
}
