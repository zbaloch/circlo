import { useCallback, useRef, type ComponentPropsWithRef } from 'react';
import { Text as RNText, TextInput as RNTextInput, type TextInputInstance } from 'react-native';

import { useAutoGrow } from './auto-grow';

// Inter is bundled with the app (never fetched at runtime), so text looks the same on iOS and Android. Custom fonts
// need one family per weight, so Tailwind's font-weight classes are swapped for the matching Inter family.
const FAMILY: Record<string, string> = {
  normal: 'font-sans',
  medium: 'font-sans-medium',
  semibold: 'font-sans-semibold',
  bold: 'font-sans-bold',
  extrabold: 'font-sans-extrabold',
  black: 'font-sans-extrabold',
};

/** Replaces a font-weight class with the matching Inter family class (pure; exported for tests). */
export function fontClass(className = ''): string {
  let family = FAMILY.normal;
  const rest = className.split(/\s+/).filter((c) => {
    const m = /^font-(normal|medium|semibold|bold|extrabold|black)$/.exec(c);
    if (m) family = FAMILY[m[1]];
    return c !== '' && !m;
  });
  return [family, ...rest].join(' ');
}

export function Text({ className, ...props }: ComponentPropsWithRef<typeof RNText>) {
  return <RNText className={fontClass(className)} {...props} />;
}

export function TextInput({ className, ref, ...props }: ComponentPropsWithRef<typeof RNTextInput>) {
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
  return <RNTextInput ref={setRef} className={fontClass(`web:outline-none ${className ?? ''}`)} {...props} />;
}
