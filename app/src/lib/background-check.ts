/**
 * Notifications without remote push (owner decision 2026-10-30): Apple and Google never learn when someone gets
 * activity. A phone that opts in checks in the background now and then (the OS decides when: on Android about every
 * 15 minutes at best, on iOS a few times a day) and shows a local notification with counts only. The check uses this
 * device's check token, which can read nothing but those counts; it's kept readable while the phone is locked, unlike
 * the session. The web app uses background-check.web.ts (no background checks in browsers).
 */
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Linking, Platform } from 'react-native';

import { api, API_URL, ok } from '@/api/client';

import { deleteItem, getItem, setItem } from './storage';

export const CHECK_TASK = 'circlo.activity-check';
const CHANNEL = 'activity';
const TOKEN_KEY = 'circlo.check-token';
const SINCE_KEY = 'circlo.check-since';
const PROMPT_DISMISSED = 'circlo.notifications-prompt-dismissed';

export type Pending = { requests: number; replies: number; likes: number; messages: number; signIns: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pure: the notification text, or null when there's nothing new. Counts only: no names, no content. */
export function summary(p: Pending): string | null {
  const parts = [
    p.messages ? plural(p.messages, 'new message', 'new messages') : '',
    p.replies ? plural(p.replies, 'reply', 'replies') : '',
    p.likes ? plural(p.likes, 'like', 'likes') : '',
    p.requests ? plural(p.requests, 'friend request', 'friend requests') : '',
  ].filter(Boolean);
  if (p.signIns) return `New sign-in to your account.${parts.length ? ` Also ${parts.join(', ')}.` : ''}`;
  return parts.length ? `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()) : null;
}

// While Circlo is open there's nothing to tell: the screens are up to date.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

TaskManager.defineTask(CHECK_TASK, async () => {
  try {
    await checkNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** One background check: counts since the app was last used (or the last notification), then a local notification. */
export async function checkNow(): Promise<void> {
  const token = await getItem(TOKEN_KEY, 'background');
  if (!token) return;
  const now = new Date().toISOString();
  const since = (await getItem(SINCE_KEY, 'background')) ?? now;
  // A plain request: no session involved, so a dead token never triggers a session refresh.
  const res = await fetch(`${API_URL}/v1/activity/pending?since=${encodeURIComponent(since)}`, { headers: { 'X-Circlo-Check-Token': token } });
  if (res.status === 401) return stopLocally(); // the device was revoked or checks were turned off elsewhere
  if (!res.ok) throw new Error(`check failed: ${res.status}`);
  const text = summary((await res.json()) as Pending);
  if (text) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Circlo', body: text },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  }
  await setItem(SINCE_KEY, now, 'background');
}

/** The app is in use: anything up to now is seen there, so later checks only count what's newer. */
export async function markActiveNow(): Promise<void> {
  if (await getItem(TOKEN_KEY, 'background')) {
    await setItem(SINCE_KEY, new Date().toISOString(), 'background').catch(() => undefined);
  }
}

// ---------------- turning it on and off ----------------

/** `ask`: the system popup can still be shown (once on iOS, twice on Android); `blocked`: only the phone's settings. */
export type NotificationPermission = 'on' | 'ask' | 'blocked';

/** Pure: the permission state from the platform's answer. Exported for tests. */
export function permissionFrom(perm: { granted: boolean; canAskAgain: boolean }): NotificationPermission {
  if (perm.granted) return 'on';
  return perm.canAskAgain ? 'ask' : 'blocked';
}

export async function notificationPermission(): Promise<NotificationPermission> {
  return permissionFrom(await Notifications.getPermissionsAsync());
}

/** Whether background checks are on for this phone. */
export async function backgroundChecksOn(): Promise<boolean> {
  const token = await getItem(TOKEN_KEY, 'background');
  return !!token && (await notificationPermission()) === 'on';
}

/**
 * The user said yes on Circlo's screen or in Settings: ask for permission (the system popup, or the phone's settings
 * if it can't be shown again), then get this device's check token and schedule the checks.
 */
export async function enableBackgroundChecks(): Promise<NotificationPermission> {
  if (Platform.OS === 'android') {
    // Android 13+ shows the permission popup only once a channel exists.
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'New activity', importance: AndroidImportance.DEFAULT });
  }
  let state = await notificationPermission();
  if (state === 'blocked') {
    await Linking.openSettings();
    return state;
  }
  if (state === 'ask') state = permissionFrom(await Notifications.requestPermissionsAsync());
  if (state !== 'on') return state;
  const { token } = ok(await api.POST('/v1/devices/current/check-token'));
  await setItem(TOKEN_KEY, token, 'background');
  await setItem(SINCE_KEY, new Date().toISOString(), 'background');
  await BackgroundTask.registerTaskAsync(CHECK_TASK, { minimumInterval: 15 });
  return 'on';
}

/** Off in Settings: the server forgets the token, and the phone stops checking. */
export async function disableBackgroundChecks(): Promise<void> {
  await api.DELETE('/v1/devices/current/check-token').catch(() => undefined);
  await stopLocally();
}

/** Forgets the token and stops the task (also on sign-out, when the server revokes the device anyway). */
export async function stopLocally(): Promise<void> {
  await deleteItem(TOKEN_KEY, 'background');
  await deleteItem(SINCE_KEY, 'background');
  if (await TaskManager.isTaskRegisteredAsync(CHECK_TASK).catch(() => false)) {
    await BackgroundTask.unregisterTaskAsync(CHECK_TASK).catch(() => undefined);
  }
}

// ---------------- offering it once ----------------

/** Pure: Circlo's notifications screen is offered once, only while the system popup can still be shown. */
export function shouldOffer(state: NotificationPermission, dismissed: boolean): boolean {
  return state === 'ask' && !dismissed;
}

let offered = false;

/** Whether to open Circlo's notifications screen now (at most once per launch; never again after "Not now"). */
export async function offerBackgroundChecksNow(): Promise<boolean> {
  if (offered) return false;
  offered = true;
  try {
    const dismissed = (await getItem(PROMPT_DISMISSED)) === '1';
    return shouldOffer(await notificationPermission(), dismissed);
  } catch {
    return false;
  }
}

/** "Not now" (or done): don't open the screen again; Settings still has the switch. */
export function dismissNotificationsPrompt() {
  setItem(PROMPT_DISMISSED, '1').catch(() => undefined);
}

/** Tapping one of these notifications opens the Notifications tab. */
export function onNotificationOpened(open: () => void): () => void {
  Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      if (r) {
        Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
        open();
      }
    })
    .catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(() => open());
  return () => sub.remove();
}
