/**
 * The web app has no background checks: browsers can't run them without push, and Circlo doesn't use remote push.
 * The Notifications tab is refreshed while the page is open. Same exports as background-check.ts.
 */
export const CHECK_TASK = 'circlo.activity-check';

export type Pending = { requests: number; replies: number; likes: number; messages: number; signIns: number };
export type NotificationPermission = 'on' | 'ask' | 'blocked';

export async function checkNow(): Promise<void> {}
export async function markActiveNow(): Promise<void> {}
export async function notificationPermission(): Promise<NotificationPermission> {
  return 'blocked';
}
export async function backgroundChecksOn(): Promise<boolean> {
  return false;
}
export async function enableBackgroundChecks(): Promise<NotificationPermission> {
  return 'blocked';
}
export async function disableBackgroundChecks(): Promise<void> {}
export async function stopLocally(): Promise<void> {}
export async function offerBackgroundChecksNow(): Promise<boolean> {
  return false;
}
export function dismissNotificationsPrompt() {}
export const usesPush = false;
export async function refreshPushToken(): Promise<void> {}
export function onNotificationOpened(_open: (data: Record<string, unknown>) => void): () => void {
  return () => undefined;
}
