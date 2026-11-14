import { useCallback, useRef, type ComponentPropsWithRef } from 'react';
import { Text as RNText, TextInput as RNTextInput, type TextInputInstance } from 'react-native';

import { useAutoGrow } from './auto-grow';

// Inter is bundled with the app (never fetched at runtime), so text looks the same on iOS and Android. Custom fonts
// need one family per weight, so Tailwind's font-weight classes are swapped for the matching Inter family. Text in a
// script Inter doesn't cover (`system`, lib/script) gets no family at all, so the phone or browser draws it in its own
// font for that script, with the weight kept as a plain font-weight.
type Weight = 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold' | 'black';
// Spelled out in full so Tailwind finds every class (it can't see names put together at runtime).
const FAMILIES: Record<'sans' | 'system', Record<Weight, string>> = {
  sans: { normal: 'font-sans', medium: 'font-sans-medium', semibold: 'font-sans-semibold', bold: 'font-sans-bold', extrabold: 'font-sans-extrabold', black: 'font-sans-extrabold' },
  system: { normal: 'font-normal', medium: 'font-medium', semibold: 'font-semibold', bold: 'font-bold', extrabold: 'font-extrabold', black: 'font-extrabold' },
};

/** Replaces a font-weight class with the matching Inter family class, or a plain weight for the phone's fonts (pure; exported for tests). */
export function fontClass(className = '', system = false): string {
  let weight: Weight = 'normal';
  const rest = className.split(/\s+/).filter((c) => {
    const m = /^font-(normal|medium|semibold|bold|extrabold|black)$/.exec(c);
    if (m) weight = m[1] as Weight;
    return c !== '' && !m;
  });
  return [FAMILIES[system ? 'system' : 'sans'][weight], ...rest].join(' ');
}

type SystemProp = {
  /** Text with letters Inter hasn't got (lib/script usesSystemFont): drawn in the phone's own font. */
  system?: boolean;
};

export function Text({ className, system, ...props }: ComponentPropsWithRef<typeof RNText> & SystemProp) {
  return <RNText className={fontClass(className, system)} {...props} />;
}

export function TextInput({ className, ref, system, ...props }: ComponentPropsWithRef<typeof RNTextInput> & SystemProp) {
  const own = useRef<TextInputInstance>(null);
  // Multiline fields grow with their text on the web too (phones do it themselves).
  useAutoGrow(own, !!props.multiline, props.value);
  const setRef = useCallback(
    (node: TextInputInstance | null) => {
      own.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  // No browser focus outline on the web (phones draw none); fields that need a focus cue style their own border.
  return <RNTextInput ref={setRef} className={fontClass(`web:outline-none ${className ?? ''}`, system)} {...props} />;
}
