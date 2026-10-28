import * as SecureStore from 'expo-secure-store';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { describeError } from './account';
import { syncConnections, type Connection } from './friends';
import type { StoredAccount } from './keystore';
import { onPushActivity } from './push';
import { useSession } from './session';

/**
 * Connections (requests + friends) shared by every screen, so the bell's dot, Notifications and Friends agree.
 * Refreshed when a screen gains focus, every POLL_MS while the app is open, and on (content-free) push activity.
 * Which requests I've already seen is kept on this device only, in the keystore.
 */
const POLL_MS = 15_000;
const MAX_SEEN = 500;

type State = { owner: string | null; connections: Connection[] | null; error?: string; seen: ReadonlySet<string> | null };

let state: State = { owner: null, connections: null, seen: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const seenKey = (userId: string) => `circlo.seen-requests.${userId}`;
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Starts over when a different account signs in. */
function ensureOwner(account: StoredAccount) {
  if (state.owner === account.userId) return;
  set({ owner: account.userId, connections: null, error: undefined, seen: null });
  SecureStore.getItemAsync(seenKey(account.userId), OPTIONS).then(
    (raw) => state.owner === account.userId && set({ seen: new Set<string>(raw ? JSON.parse(raw) : []) }),
    () => state.owner === account.userId && set({ seen: new Set() }),
  );
}

export function refreshConnections(account: StoredAccount): Promise<void> {
  ensureOwner(account);
  inflight ??= syncConnections(account)
    .then(
      (c) => state.owner === account.userId && set({ connections: c, error: undefined }),
      (e) => state.owner === account.userId && set({ error: describeError(e) }),
    )
    .then(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** On sign-out: drop the shared connections and this account's "seen requests" list from the device. */
export async function forgetConnections(userId: string): Promise<void> {
  set({ owner: null, connections: null, error: undefined, seen: null });
  await SecureStore.deleteItemAsync(seenKey(userId), OPTIONS);
}

/** Incoming requests I haven't looked at yet (none until the seen list has loaded, so the dot never flashes). */
export function unseenRequestIds(connections: Connection[] | null, seen: ReadonlySet<string> | null): string[] {
  if (!connections || !seen) return [];
  return connections.filter((c) => c.status === 'incoming' && !seen.has(c.userId)).map((c) => c.userId);
}

/** Marks every current incoming request as seen. Only ids still pending are kept, so the list stays small. */
export function markRequestsSeen(account: StoredAccount) {
  if (state.owner !== account.userId || !state.connections || !state.seen) return;
  const incoming = state.connections.filter((c) => c.status === 'incoming').map((c) => c.userId);
  if (incoming.every((id) => state.seen!.has(id))) return;
  const next = new Set(incoming.slice(-MAX_SEEN));
  set({ seen: next });
  void SecureStore.setItemAsync(seenKey(account.userId), JSON.stringify([...next]), OPTIONS).catch(() => {});
}

function useStore() {
  return useSyncExternalStore(subscribe, () => state);
}

/** Connections for the signed-in account, refreshed whenever the screen gains focus. */
export function useConnections() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const s = useStore();
  const mine = account && s.owner === account.userId;

  const refresh = useCallback(() => (account ? refreshConnections(account) : Promise.resolve()), [account]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return {
    account,
    connections: mine ? s.connections : null,
    error: mine ? s.error : undefined,
    unseenRequests: mine ? unseenRequestIds(s.connections, s.seen) : [],
    refresh,
  };
}

/** Keeps connections fresh while signed in: a poll while the app is in the foreground, plus push activity. */
export function useConnectionsSync() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  useEffect(() => {
    if (!account) return;
    const tick = () => {
      if (AppState.currentState === 'active') void refreshConnections(account);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    const appState = AppState.addEventListener('change', (s) => s === 'active' && tick());
    const unsubscribePush = onPushActivity(tick);
    return () => {
      clearInterval(timer);
      appState.remove();
      unsubscribePush();
    };
  }, [account]);
}

/** Whether the bell should show its dot. */
export function useHasUnseenRequests(): boolean {
  const session = useSession();
  const s = useStore();
  if (session.status !== 'signedIn' || s.owner !== session.account.userId) return false;
  return unseenRequestIds(s.connections, s.seen).length > 0;
}

export function displayName(c: Connection): string {
  return c.profile?.displayName || (c.profile?.handle ? `@${c.profile.handle}` : 'Someone');
}
