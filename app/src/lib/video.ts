import type { Attachment } from '@/lib/media';

/**
 * The full-screen video viewer (app/video.tsx, owner request 2026-11-08): videos in posts and chats show their poster
 * with a play button, and play full screen with Circlo's own controls instead of the phone's.
 */

/** Controls fade out this long after the last touch, while the video plays. */
export const CONTROLS_HIDE_MS = 2500;

/** Seconds as a clock: 0:07, 1:02, 1:02:03. */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The time at `x` along a progress bar `width` wide, for a video `duration` seconds long. */
export function timeAt(x: number, width: number, duration: number): number {
  if (width <= 0 || duration <= 0) return 0;
  return Math.min(1, Math.max(0, x / width)) * duration;
}

// Sound on or off is remembered while the app is open: turn it off once and the next video starts silent too.
let muted = false;

export function soundMuted(): boolean {
  return muted;
}

export function rememberMuted(value: boolean) {
  muted = value;
}

// The video to show, handed to the viewer in memory (download URLs never go in route params). Cleared at sign-out.
let opened: Attachment | null = null;

export function openVideo(video: Attachment | null) {
  opened = video;
}

export function openedVideo(): Attachment | null {
  return opened;
}
