/**
 * Notifications (owner decisions 2026-11-01): one calm, content-free push a day on iPhone (APNs) and Android (FCM),
 * around 6pm on the phone's clock and only on days something happened: "You have a few new things waiting". A tap
 * opens Notifications (lib/push-route); names and words stay in Circlo. Account alerts (new sign-in and so on) come by
 * email straight away. An Android build without FCM (no google-services.json) falls back to background checks: now and
 * then (about every 15 minutes at best) the phone asks for counts with this device's check token, which can read
 * nothing else, and shows the same calm note at most once a day (a new sign-in at once). The web app uses
 * background-check.web.ts (nothing in browsers).
 */
import * as BackgroundTask from 'expo-background-task';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Linking, Platform } from 'react-native';

import { api, API_URL, ok } from '@/api/client';

import { pushServiceFor } from './push-route';
import { deleteItem, getItem, setItem } from './storage';
import { LIKES_ENABLED } from './features';

export const CHECK_TASK = 'circlo.activity-check';
const CHANNEL = 'activity';
const TOKEN_KEY = 'circlo.check-token';
const SINCE_KEY = 'circlo.check-since';
const TOLD_KEY = 'circlo.check-told';
/** Background checks tell about activity at most this often. */
const DAILY_MS = 20 * 60 * 60 * 1000;
const CALM = 'You have a few new things waiting. Catch up when you’re ready.';
const PROMPT_DISMISSED = 'circlo.notifications-prompt-dismissed';
const PUSH_ON = 'circlo.push-on';

/** Remote push on iPhone, and on Android builds made with FCM; otherwise background checks. */
export const usesPush = Platform.OS === 'ios' || (Platform.OS === 'android' && Constants.expoConfig?.extra?.androidPush === true);


/** Sends this phone's push token to the server (tokens can change, so this runs on every launch while push is on). */
async function registerPush(): Promise<void> {
  // Android shows pushes on the "activity" channel the server names; it must exist first.
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'New activity', importance: AndroidImportance.HIGH });
  const token = await Notifications.getDevicePushTokenAsync();
  const service = pushServiceFor(Platform.OS, Constants.expoConfig?.extra);
  ok(await api.PUT('/v1/devices/current/push-token', { body: { token: String(token.data), service } }));
}

/** On launch: re-sends the token if push is on and still allowed. */
export async function refreshPushToken(): Promise<void> {
  if (!usesPush || (await getItem(PUSH_ON, 'background')) !== '1' || (await notificationPermission()) !== 'on') return;
  await registerPush();
}

export type Pending = { requests: number; replies: number; likes: number; messages: number; signIns: number };

/** Pure: the notification text, or null when there's nothing new. Calm: never who, what or how many. */
export function summary(p: Pending, likes = LIKES_ENABLED): string | null {
  if (p.signIns) return 'New sign-in to your account. If it wasn’t you, change your password in Settings.';
  return p.messages || p.replies || p.requests || (likes && p.likes) ? CALM : null;
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
  const pending = (await res.json()) as Pending;
  const text = summary(pending);
  if (text && !pending.signIns) {
    // Activity at most once a day: until then it keeps waiting (the time isn't moved on).
    const told = await getItem(TOLD_KEY, 'background');
    if (told && Date.now() - Date.parse(told) < DAILY_MS) return;
  }
  if (text) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Circlo', body: text },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
    await setItem(TOLD_KEY, now, 'background');
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
  if (usesPush) return (await getItem(PUSH_ON, 'background')) === '1' && (await notificationPermission()) === 'on';
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
  if (usesPush) {
    await registerPush();
    await setItem(PUSH_ON, '1', 'background');
    return 'on';
  }
  const { token } = ok(await api.POST('/v1/devices/current/check-token'));
  await setItem(TOKEN_KEY, token, 'background');
  await setItem(SINCE_KEY, new Date().toISOString(), 'background');
  await BackgroundTask.registerTaskAsync(CHECK_TASK, { minimumInterval: 15 });
  return 'on';
}

/** Off in Settings: the server forgets the token, and the phone stops checking. */
export async function disableBackgroundChecks(): Promise<void> {
  if (usesPush) await api.DELETE('/v1/devices/current/push-token').catch(() => undefined);
  await api.DELETE('/v1/devices/current/check-token').catch(() => undefined);
  await stopLocally();
}

/** Forgets the token and stops the task (also on sign-out, when the server revokes the device anyway). */
export async function stopLocally(): Promise<void> {
  await deleteItem(TOKEN_KEY, 'background');
  await deleteItem(SINCE_KEY, 'background');
  await deleteItem(PUSH_ON, 'background');
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

/** A tapped notification, with its routing data (see lib/push-route), also when it launched the app. */
export function onNotificationOpened(open: (data: Record<string, unknown>) => void): () => void {
  Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      if (r) {
        Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
        open(r.notification.request.content.data ?? {});
      }
    })
    .catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data ?? {}));
  return () => sub.remove();
}
