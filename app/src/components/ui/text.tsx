import { useCallback, useRef, type ComponentPropsWithRef } from 'react';
import { Text as RNText, TextInput as RNTextInput, type TextInputInstance } from 'react-native';

import type { Script } from '@/lib/script';

import { useAutoGrow } from './auto-grow';

// Inter is bundled with the app (never fetched at runtime), so text looks the same on iOS and Android. Custom fonts
// need one family per weight, so Tailwind's font-weight classes are swapped for the matching family: Inter, or for
// Arabic-script text (`script`, lib/script) Noto Naskh Arabic or Noto Nastaliq Urdu, also bundled.
const WEIGHTS = ['normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'] as const;
type Weight = (typeof WEIGHTS)[number];
// Spelled out in full so Tailwind finds every class (it can't see names put together at runtime). The Arabic-script
// fonts go up to bold.
const FAMILIES: Record<'sans' | Script, Record<Weight, string>> = {
  sans: { normal: 'font-sans', medium: 'font-sans-medium', semibold: 'font-sans-semibold', bold: 'font-sans-bold', extrabold: 'font-sans-extrabold', black: 'font-sans-extrabold' },
  naskh: { normal: 'font-naskh', medium: 'font-naskh-medium', semibold: 'font-naskh-semibold', bold: 'font-naskh-bold', extrabold: 'font-naskh-bold', black: 'font-naskh-bold' },
  nastaliq: { normal: 'font-nastaliq', medium: 'font-nastaliq-medium', semibold: 'font-nastaliq-semibold', bold: 'font-nastaliq-bold', extrabold: 'font-nastaliq-bold', black: 'font-nastaliq-bold' },
};

function family(base: 'sans' | Script, weight: Weight): string {
  return FAMILIES[base][weight];
}

/** Replaces a font-weight class with the matching family class (pure; exported for tests). */
export function fontClass(className = '', script?: Script | null): string {
  let weight: (typeof WEIGHTS)[number] = 'normal';
  const rest = className.split(/\s+/).filter((c) => {
    const m = /^font-(normal|medium|semibold|bold|extrabold|black)$/.exec(c);
    if (m) weight = m[1] as (typeof WEIGHTS)[number];
    return c !== '' && !m;
  });
  return [family(script ?? 'sans', weight), ...rest].join(' ');
}

type ScriptProp = { script?: Script | null };

export function Text({ className, script, ...props }: ComponentPropsWithRef<typeof RNText> & ScriptProp) {
  return <RNText className={fontClass(className, script)} {...props} />;
}

export function TextInput({ className, ref, script, ...props }: ComponentPropsWithRef<typeof RNTextInput> & ScriptProp) {
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
  return <RNTextInput ref={setRef} className={fontClass(`web:outline-none ${className ?? ''}`, script)} {...props} />;
}
