/**
 * Content-free push (PLAN.md Phase 10). The server only ever sends "new activity"; the app then fetches and decrypts
 * as usual. The device token is sent to the server, which stores it sealed (HALQO_PUSH_TOKEN_KEY, outside the DB).
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/api/client';

import type { StoredAccount } from './keystore';

let registeredFor: string | null = null;

/**
 * Registers this device for pushes once per session. Silently does nothing if the user declines or the build has no
 * push configuration (FCM's google-services.json comes from EAS credentials, never the repo).
 */
export async function registerForPush(account: StoredAccount): Promise<void> {
  if (registeredFor === account.deviceId) return;
  try {
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;
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

/** Runs `onActivity` whenever a push arrives while the app is open (it carries no content; just sync). */
export function onPushActivity(onActivity: () => void): () => void {
  const sub = Notifications.addNotificationReceivedListener(() => onActivity());
  return () => sub.remove();
}

export function resetPush() {
  registeredFor = null;
}
