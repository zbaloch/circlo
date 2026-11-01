import type { Href } from 'expo-router';

import { CHAT_ENABLED } from './features';

/** Pure: which push service this device's token belongs to (Android: FCM; iPhone: per the build's entitlement). */
export function pushServiceFor(os: string, extra: { pushService?: string } | undefined): 'apns' | 'apns_sandbox' | 'fcm' {
  if (os === 'android') return 'fcm';
  return extra?.pushService === 'apns_sandbox' ? 'apns_sandbox' : 'apns';
}

/**
 * Pure: where tapping a notification goes. The daily push ("digest") and background-check notes open Notifications.
 * Older pushes carried a type and random ids: a reply opened the thread at that reply, a message its chat, a request
 * the friend requests.
 */
export function pushRoute(data: Record<string, unknown> | null | undefined, chat = CHAT_ENABLED): Href {
  const str = (k: string) => (typeof data?.[k] === 'string' && /^[0-9a-f-]{36}$/i.test(data[k] as string) ? (data[k] as string) : null);
  const type = data?.type;
  if (type === 'reply' && str('postId') && str('replyId')) return { pathname: '/post/[id]', params: { id: str('postId')!, reply: str('replyId')! } };
  if (type === 'message' && chat && str('chatId')) return { pathname: '/chat/[id]', params: { id: str('chatId')! } };
  if (type === 'request') return { pathname: '/search', params: { section: 'friends' } };
  return '/notifications';
}
