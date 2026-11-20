import type { PickedMedia } from './media';

/**
 * Pasted images added to a post's photos: up to `max` in all, none beside a video (a post has one video or up to
 * `max` photos). `dropped` are the ones that didn't fit, to be discarded. Pure.
 */
export function addPasted(current: PickedMedia[], pasted: PickedMedia[], max: number): { media: PickedMedia[]; dropped: PickedMedia[] } {
  if (current.some((m) => m.type === 'video')) return { media: current, dropped: pasted };
  const room = Math.max(0, max - current.length);
  return { media: [...current, ...pasted.slice(0, room)], dropped: pasted.slice(room) };
}
