/** Zooming a photo in the viewer (worklets: they run in the gesture handlers too). */
export const MAX_ZOOM = 5;
export const DOUBLE_TAP_ZOOM = 2.5;

/** How far a photo zoomed to `scale` may move from the centre, along a side `size` long: up to its edge, no further. */
export function clampPan(offset: number, scale: number, size: number): number {
  'worklet';
  const max = (size * (scale - 1)) / 2;
  return Math.min(max, Math.max(-max, offset));
}

/** Double-tap: in from normal size, back out from any zoom. */
export function doubleTapScale(scale: number): number {
  'worklet';
  return scale > 1 ? 1 : DOUBLE_TAP_ZOOM;
}
