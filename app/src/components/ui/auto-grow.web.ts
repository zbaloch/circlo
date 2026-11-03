import { useLayoutEffect, type RefObject } from 'react';

/**
 * Web: a multiline field is a <textarea>, which keeps a fixed height and scrolls inside. Size it to its text instead,
 * as a phone's multiline field does by itself: measure at height auto, then set the content height. A max-height class
 * still caps it (it then scrolls inside); min-height classes keep room to tap while empty. Set on the element, as
 * auto-size libraries do, because the height comes from the text and can't be a class.
 */
export function fitToContent(el: HTMLElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/** Keeps a multiline field fitted to its text: on every change, typed or set, and when the window resizes (rewrapping). */
export function useAutoGrow(ref: RefObject<unknown>, enabled: boolean, value: unknown) {
  useLayoutEffect(() => {
    if (enabled) fitToContent(ref.current as HTMLElement | null);
  }, [ref, enabled, value]);

  useLayoutEffect(() => {
    const el = ref.current as HTMLElement | null;
    if (!enabled || !el?.addEventListener) return;
    const fit = () => fitToContent(el);
    el.addEventListener('input', fit);
    window.addEventListener('resize', fit);
    return () => {
      el.removeEventListener('input', fit);
      window.removeEventListener('resize', fit);
    };
  }, [ref, enabled]);
}
