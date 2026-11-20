/**
 * Swipe a chat message to the right to reply to it, as in WhatsApp. These run on the UI thread inside the gesture
 * (hence 'worklet'), and are plain functions for tests.
 */

/** How far (in points) a message must be pulled before letting go replies to it. */
export const SWIPE_REPLY = 56;
/** The furthest a message moves, however far the finger goes. */
export const SWIPE_MAX = 84;

/** Where the message sits for a finger moved `dx` sideways: with it up to the reply point, then slower; never to the left. */
export function swipeOffset(dx: number): number {
  'worklet';
  if (dx <= 0) return 0;
  if (dx <= SWIPE_REPLY) return dx;
  return Math.min(SWIPE_MAX, SWIPE_REPLY + (dx - SWIPE_REPLY) / 3);
}

/** Whether letting go now replies. */
export function swipeReplies(dx: number): boolean {
  'worklet';
  return dx >= SWIPE_REPLY;
}
