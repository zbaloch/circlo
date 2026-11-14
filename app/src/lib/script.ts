/**
 * Which way text runs, and whether it's drawn in Inter or the phone's own fonts (owner decisions 2026-11-07, 2026-11-15).
 * Pure; no language is stored or sent anywhere. Inter (bundled) covers Latin, Greek and Cyrillic; text with letters from
 * any other script (Arabic, Urdu, Sindhi, Persian, Hebrew, Hindi, Chinese, Japanese, Korean, Thai…) is drawn in the
 * phone's or browser's own fonts, which know those scripts best. Arabic-script and Hebrew text is right to left.
 */

export type Direction = 'ltr' | 'rtl';
export type Run = { text: string; dir: Direction; system: boolean };

// Right-to-left letters: Hebrew, Arabic and its supplements and presentation forms.
const RTL = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LETTER = /\p{L}/u;
// Inter's scripts: Latin (with its extensions and Vietnamese), Greek and Cyrillic.
const INTER = /[\u0000-\u052F\u1C80-\u1C8F\u1D00-\u1FFF\u2C60-\u2C7F\u2DE0-\u2DFF\uA640-\uA69F\uA720-\uA7FF\uAB30-\uAB6F\uFB00-\uFB06]/;

/** Pure: the direction of the first real letter (digits, emoji and punctuation don't count), or null if none. */
export function textDirection(text: string): Direction | null {
  for (const ch of text) {
    if (LETTER.test(ch)) return RTL.test(ch) ? 'rtl' : 'ltr';
  }
  return null;
}

/** Pure: true when the text has a letter Inter can't draw, so it should use the phone's own fonts. */
export function usesSystemFont(text: string): boolean {
  for (const ch of text) {
    if (LETTER.test(ch) && !INTER.test(ch)) return true;
  }
  return false;
}

/**
 * Pure: the text in paragraphs that keep their own direction, so a post that mixes an English line with a Sindhi
 * verse lays out each the right way. Blank and neutral lines (only digits, emoji, punctuation) join the run above, or
 * the first run when they come first. Each run is in Inter, or the phone's fonts if it has letters Inter hasn't got.
 */
export function runs(text: string): Run[] {
  const out: { text: string; dir: Direction }[] = [];
  let pending: string[] = [];
  for (const line of text.split('\n')) {
    const dir = textDirection(line);
    const last = out[out.length - 1];
    if (dir === null) {
      if (last) last.text += '\n' + line;
      else pending.push(line);
    } else if (last && last.dir === dir) {
      last.text += '\n' + line;
    } else {
      out.push({ text: [...pending, line].join('\n'), dir });
      pending = [];
    }
  }
  if (!out.length) return [{ text, dir: 'ltr', system: usesSystemFont(text) }];
  return out.map((r) => ({ ...r, system: usesSystemFont(r.text) }));
}
