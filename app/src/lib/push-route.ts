import type { Href } from 'expo-router';

import { CHAT_ENABLED } from './features';

/** Pure: which push service this device's token belongs to (Android: FCM; iPhone: per the build's entitlement). */
export function pushServiceFor(os: string, extra: { pushService?: string } | undefined): 'apns' | 'apns_sandbox' | 'fcm' {
  if (os === 'android') return 'fcm';
  return extra?.pushService === 'apns_sandbox' ? 'apns_sandbox' : 'apns';
}

/**
 * Pure: where tapping a notification goes. Pushes carry a type and random ids (owner 2026-11-18): a reply opens the
 * thread at that reply, a message its chat, a request the friend requests, a People reminder
 * (birthday, catch-up) that person's page. A new friend ("friend"), the daily push
 * ("digest"), the server's test push and background-check notes open Notifications.
 */
export function pushRoute(data: Record<string, unknown> | null | undefined, chat = CHAT_ENABLED): Href {
  const str = (k: string) => (typeof data?.[k] === 'string' && /^[0-9a-f-]{36}$/i.test(data[k] as string) ? (data[k] as string) : null);
  const type = data?.type;
  if (type === 'reply' && str('postId') && str('replyId')) return { pathname: '/post/[id]', params: { id: str('postId')!, reply: str('replyId')! } };
  if (type === 'message' && chat && str('chatId')) return { pathname: '/chat/[id]', params: { id: str('chatId')! } };
  if (type === 'request') return { pathname: '/search', params: { section: 'friends' } };
  // A People reminder (scheduled on this phone): that person's page.
  if (type === 'people' && str('contactId')) return { pathname: '/people/[id]', params: { id: str('contactId')! } };
  // Security alerts (new sign-in, password changed, a device signed out): the timeline, which shows a new sign-in in full.
  if (type === 'security') return '/';
  return '/notifications';
}
