/**
 * Content-free push (PLAN.md Phase 10). The server only ever sends "new activity"; the app then fetches and decrypts
 * as usual. The device token is sent to the server, which stores it sealed (CIRCLO_PUSH_TOKEN_KEY, outside the DB).
 */
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Linking, Platform } from 'react-native';

import { api } from '@/api/client';

import type { StoredAccount } from './keystore';

let registeredFor: string | null = null;

/**
 * Where notification permission stands: `ask` means the system popup can still be shown. iOS and Android show it
 * only once (Android twice), so Circlo asks on its own screen first and shows the popup only when the user says yes;
 * after a "no" in the popup the user can only turn notifications on in the phone's settings (`blocked`).
 */
export type PushPermission = 'on' | 'ask' | 'blocked';

/** Pure: the permission state from the platform's answer. Exported for tests. */
export function pushPermissionFrom(perm: { granted: boolean; canAskAgain: boolean }): PushPermission {
  if (perm.granted) return 'on';
  return perm.canAskAgain ? 'ask' : 'blocked';
}

export async function pushPermission(): Promise<PushPermission> {
  return pushPermissionFrom(await Notifications.getPermissionsAsync());
}

/**
 * Registers this device for pushes once per session, if notifications are already allowed; it never shows the system
 * popup (that's `enablePush`). Silently does nothing if the build has no push configuration (FCM's
 * google-services.json comes from EAS credentials, never the repo).
 */
export async function registerForPush(account: StoredAccount): Promise<void> {
  if (registeredFor === account.deviceId) return;
  try {
    if ((await pushPermission()) !== 'on') return;
    const token = await Notifications.getDevicePushTokenAsync();
    const res = await api.PUT('/v1/devices/{deviceId}/push-token', {
      params: { path: { deviceId: account.deviceId } },
      body: { token: String(token.data), platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
    if (res.response.ok) registeredFor = account.deviceId;
  } catch {
    // no push configuration in this build (e.g. a local dev build): the app still syncs when opened
  }
}

/** The user said yes on Circlo's screen: show the system popup, or the phone's settings if it can't be shown again. */
export async function enablePush(account: StoredAccount): Promise<PushPermission> {
  if ((await pushPermission()) === 'blocked') {
    await Linking.openSettings();
    return 'blocked';
  }
  const state = pushPermissionFrom(await Notifications.requestPermissionsAsync());
  if (state === 'on') await registerForPush(account);
  return state;
}

const PROMPT_DISMISSED = 'circlo.push-prompt-dismissed';
let offered = false;

/** Pure: Circlo's notifications screen is offered once, only while the system popup can still be shown. */
export function shouldOfferPush(state: PushPermission, dismissed: boolean): boolean {
  return state === 'ask' && !dismissed;
}

/** Whether to open Circlo's notifications screen now (at most once per launch; never again after "Not now"). */
export async function offerPushNow(): Promise<boolean> {
  if (offered) return false;
  offered = true;
  try {
    const dismissed = (await SecureStore.getItemAsync(PROMPT_DISMISSED)) === '1';
    return shouldOfferPush(await pushPermission(), dismissed);
  } catch {
    return false;
  }
}

/** "Not now": don't open the screen again; Settings still has a Notifications row. */
export function dismissPushPrompt() {
  SecureStore.setItemAsync(PROMPT_DISMISSED, '1').catch(() => undefined);
}

/** Runs `onActivity` whenever a push arrives while the app is open (it carries no content; just sync). */
export function onPushActivity(onActivity: () => void): () => void {
  const sub = Notifications.addNotificationReceivedListener(() => onActivity());
  return () => sub.remove();
}

export function resetPush() {
  registeredFor = null;
}
