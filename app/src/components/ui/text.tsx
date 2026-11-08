import { useCallback, useRef, type ComponentPropsWithRef } from 'react';
import { Text as RNText, TextInput as RNTextInput, type TextInputInstance } from 'react-native';

import type { Script } from '@/lib/script';

import { useAutoGrow } from './auto-grow';

// Inter is bundled with the app (never fetched at runtime), so text looks the same on iOS and Android. Custom fonts
// need one family per weight, so Tailwind's font-weight classes are swapped for the matching family: Inter, or for
// Arabic-script text (`script`, lib/script) Lateef, Noto Naskh Arabic or Noto Nastaliq Urdu, also bundled.
type Weight = 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold' | 'black';
// Spelled out in full so Tailwind finds every class (it can't see names put together at runtime). The Arabic-script
// fonts go up to bold (Lateef to extra bold).
const FAMILIES: Record<'sans' | Script, Record<Weight, string>> = {
  sans: { normal: 'font-sans', medium: 'font-sans-medium', semibold: 'font-sans-semibold', bold: 'font-sans-bold', extrabold: 'font-sans-extrabold', black: 'font-sans-extrabold' },
  lateef: { normal: 'font-lateef', medium: 'font-lateef-medium', semibold: 'font-lateef-semibold', bold: 'font-lateef-bold', extrabold: 'font-lateef-extrabold', black: 'font-lateef-extrabold' },
  naskh: { normal: 'font-naskh', medium: 'font-naskh-medium', semibold: 'font-naskh-semibold', bold: 'font-naskh-bold', extrabold: 'font-naskh-bold', black: 'font-naskh-bold' },
  nastaliq: { normal: 'font-nastaliq', medium: 'font-nastaliq-medium', semibold: 'font-nastaliq-semibold', bold: 'font-nastaliq-bold', extrabold: 'font-nastaliq-bold', black: 'font-nastaliq-bold' },
};

function family(base: 'sans' | Script, weight: Weight): string {
  return FAMILIES[base][weight];
}

// Tailwind's text sizes in px, and Lateef's: its letters are small for their size, so it's drawn half again as big,
// with room for its tall letters and dots. Spelled out so Tailwind finds every class.
const SIZES: Record<string, number> = { 'text-xs': 12, 'text-[13px]': 13, 'text-sm': 14, 'text-[15px]': 15, 'text-base': 16, 'text-[17px]': 17, 'text-lg': 18, 'text-xl': 20 };
const LATEEF: Record<number, string> = {
  12: 'text-[18px] leading-[28px]',
  13: 'text-[20px] leading-[30px]',
  14: 'text-[21px] leading-[32px]',
  15: 'text-[23px] leading-[34px]',
  16: 'text-[24px] leading-[38px]',
  17: 'text-[26px] leading-[40px]',
  18: 'text-[27px] leading-[42px]',
  20: 'text-[30px] leading-[46px]',
};

/** Pure: Lateef's size and line height for text styled `classes` (16px when no size is given). */
function lateefSize(classes: string[]): string[] {
  const size = classes.map((c) => SIZES[c]).find((n) => n !== undefined) ?? 16;
  return [...classes.filter((c) => SIZES[c] === undefined && !c.startsWith('leading-')), LATEEF[size]];
}

/** Replaces a font-weight class with the matching family class, and sizes Lateef up (pure; exported for tests). */
export function fontClass(className = '', script?: Script | null): string {
  let weight: Weight = 'normal';
  const rest = className.split(/\s+/).filter((c) => {
    const m = /^font-(normal|medium|semibold|bold|extrabold|black)$/.exec(c);
    if (m) weight = m[1] as Weight;
    return c !== '' && !m;
  });
  return [family(script ?? 'sans', weight), ...(script === 'lateef' ? lateefSize(rest) : rest)].join(' ');
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
