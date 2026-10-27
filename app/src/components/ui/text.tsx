import type { ComponentPropsWithRef } from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';

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

export function TextInput({ className, ...props }: ComponentPropsWithRef<typeof RNTextInput>) {
  return <RNTextInput className={fontClass(className)} {...props} />;
}
