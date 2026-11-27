import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useSyncExternalStore } from 'react';

import { deleteItem, getItem, setItem } from '@/lib/storage';

/**
 * Podcast episodes from Feeds, played in Circlo (owner decision 2026-11-27). One player for the whole app, so an
 * episode keeps playing while you move around, lock the phone (lock-screen controls) or switch apps. The audio comes
 * from the podcast's own server, like tapping through to a site, so creators' download counts stay right. Where you
 * stopped in each episode is kept on this device only (never sent to Circlo) and forgotten at sign-out.
 */
export type Episode = {
  articleId: string;
  title: string;
  sourceTitle: string;
  audioUrl: string;
  /** The feed's own length, until the file says. */
  durationSeconds: number | null;
  /** Full address of its artwork (through Circlo), for the player and the lock screen. */
  artwork: string | null;
};

export type PlayerState = {
  episode: Episode | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  rate: number;
};

export const RATES = [1, 1.25, 1.5, 2] as const;
export const BACK_SECONDS = 15;
export const FORWARD_SECONDS = 30;
const POSITIONS_KEY = 'circlo.podcast-positions';
const KEEP_POSITIONS = 30;

let player: AudioPlayer | null = null;
let state: PlayerState = { episode: null, playing: false, buffering: false, position: 0, duration: 0, rate: 1 };
let pendingSeek: number | null = null;
let lastSaved = 0;
const listeners = new Set<() => void>();

function emit(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlayerState(): PlayerState {
  return state;
}

/** The player's state, kept current while it plays. */
export function usePodcastPlayer(): PlayerState {
  return useSyncExternalStore(subscribe, getPlayerState, getPlayerState);
}

// --- where I stopped, per episode (this device only) ---

type Positions = Record<string, number>;

async function loadPositions(): Promise<Positions> {
  try {
    const raw = await getItem(POSITIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Positions) : {};
  } catch {
    return {};
  }
}

/** The positions with this one set (or removed when null), newest last, at most KEEP_POSITIONS. Pure. */
export function withPosition(positions: Positions, articleId: string, seconds: number | null): Positions {
  const rest = Object.entries(positions).filter(([id]) => id !== articleId);
  const next = seconds == null ? rest : [...rest, [articleId, Math.floor(seconds)] as [string, number]];
  return Object.fromEntries(next.slice(-KEEP_POSITIONS));
}

async function savePosition(articleId: string, seconds: number | null) {
  const positions = await loadPositions();
  await setItem(POSITIONS_KEY, JSON.stringify(withPosition(positions, articleId, seconds))).catch(() => undefined);
}

/** Where I stopped in an episode, in seconds (0 if never started or finished). */
export async function savedPosition(articleId: string): Promise<number> {
  return (await loadPositions())[articleId] ?? 0;
}

// --- playing ---

function onStatus(status: AudioStatus) {
  const episode = state.episode;
  if (!episode) return;
  if (status.isLoaded && pendingSeek != null) {
    const at = pendingSeek;
    pendingSeek = null;
    void player?.seekTo(at);
  }
  if (status.didJustFinish) {
    emit({ playing: false, position: 0 });
    // Finished: next time it starts from the beginning.
    void savePosition(episode.articleId, null);
    return;
  }
  emit({
    playing: status.playing,
    buffering: status.isBuffering,
    position: pendingSeek ?? status.currentTime,
    duration: status.duration > 0 ? status.duration : (episode.durationSeconds ?? 0),
  });
  // Remember where I am every 10 seconds of listening, and whenever it pauses.
  if (status.currentTime > 0 && (Math.abs(status.currentTime - lastSaved) >= 10 || !status.playing)) {
    lastSaved = status.currentTime;
    void savePosition(episode.articleId, status.currentTime);
  }
}

/** The app's one player, created the first time something plays. */
function ensurePlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(null, { updateInterval: 500 });
    player.addListener('playbackStatusUpdate', onStatus);
  }
  return player;
}

/** Plays an episode from where I left it (or resumes it if it's the one loaded). */
export async function playEpisode(episode: Episode): Promise<void> {
  const p = ensurePlayer();
  if (state.episode?.articleId === episode.articleId) {
    p.play();
    return;
  }
  if (state.episode && state.position > 0) await savePosition(state.episode.articleId, state.position);
  // Exclusive audio focus is what ties the lock-screen controls to this player; background playback keeps it going.
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
  const start = await savedPosition(episode.articleId);
  pendingSeek = start > 0 ? start : null;
  lastSaved = start;
  emit({ episode, playing: false, buffering: true, position: start, duration: episode.durationSeconds ?? 0 });
  p.replace({ uri: episode.audioUrl });
  p.setPlaybackRate(state.rate);
  p.play();
  p.setActiveForLockScreen(
    true,
    { title: episode.title, artist: episode.sourceTitle, artworkUrl: episode.artwork ?? undefined },
    { showSeekBackward: true, showSeekForward: true },
  );
}

export function pause(): void {
  player?.pause();
}

export function resume(): void {
  player?.play();
}

/** Plays or pauses the loaded episode. */
export function toggle(): void {
  if (state.playing) pause();
  else resume();
}

export function seekTo(seconds: number): void {
  if (!player || !state.episode) return;
  const max = state.duration > 0 ? state.duration : seconds;
  const at = Math.max(0, Math.min(seconds, max));
  emit({ position: at });
  void player.seekTo(at);
}

export function skip(seconds: number): void {
  seekTo(state.position + seconds);
}

/** 1× → 1.25× → 1.5× → 2× → 1×. Pure. */
export function nextRate(rate: number): number {
  const i = RATES.findIndex((r) => r === rate);
  return RATES[(i + 1) % RATES.length];
}

export function setRate(rate: number): void {
  player?.setPlaybackRate(rate);
  emit({ rate });
}

/** Stops and unloads (sign-out): clears the lock screen and forgets every saved position. */
export async function stopPodcast(): Promise<void> {
  if (player) {
    player.pause();
    player.clearLockScreenControls();
    player.remove();
    player = null;
  }
  pendingSeek = null;
  emit({ episode: null, playing: false, buffering: false, position: 0, duration: 0 });
  await deleteItem(POSITIONS_KEY).catch(() => undefined);
}

// --- words ---

/** 36:52, 1:02:03. Pure. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "37 min", "1 hr 2 min", for an episode's length. Pure. */
export function lengthLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** 1×, 1.25×. Pure. */
export function rateLabel(rate: number): string {
  return `${rate}×`;
}
