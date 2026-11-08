/**
 * Which way text runs, and which font its script gets (owner decision 2026-11-07). Pure; no language is stored or sent
 * anywhere. Arabic-script languages are right to left and get their own bundled fonts: Lateef (SIL) for Sindhi (owner
 * request 2026-11-08), Naskh (Noto Naskh Arabic) for Arabic, Nastaliq (Noto Nastaliq Urdu) for Urdu and Persian. The
 * font files ship inside the app (npm packages), so no font is ever fetched from Google. Latin, Greek and Cyrillic stay in Inter;
 * everything else (Chinese, Japanese, Korean, Hindi…) uses the phone's own fonts.
 */

export type Direction = 'ltr' | 'rtl';
export type Script = 'lateef' | 'naskh' | 'nastaliq';
export type Run = { text: string; dir: Direction; script: Script | null };

// Right-to-left letters: Hebrew, Arabic and its supplements and presentation forms.
const RTL = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LETTER = /\p{L}/u;
// Letters only Sindhi uses: ٻ ڀ ٽ ٿ ڄ ڃ ڇ ڊ ڌ ڍ ڏ ڙ ڦ ڪ ڳ ڱ ڻ.
const SINDHI = /[ٻڀٽٿڄڃڇڊڌڍڏڙڦڪڳڱڻ]/;
// Letters Urdu uses and Arabic, Persian and Sindhi don't: ٹ ڈ ڑ ں ے ۓ.
const URDU = /[ٹڈڑںےۓ]/;
// Persian's yeh (ی) and keheh (ک), which Arabic writes as ي and ك.
const PERSIAN = /[یک]/;

/** Pure: the direction of the first real letter (digits, emoji and punctuation don't count), or null if none. */
export function textDirection(text: string): Direction | null {
  for (const ch of text) {
    if (LETTER.test(ch)) return RTL.test(ch) ? 'rtl' : 'ltr';
  }
  return null;
}

/**
 * Pure: the font style for a text's Arabic-script language, decided once for the whole text (a single line can be
 * ambiguous): Sindhi's own letters mean Sindhi (Lateef); Urdu's own letters, or Persian's ی and ک, mean Nastaliq;
 * any other Arabic-script text is Arabic (Naskh). Null for text with no Arabic script.
 */
export function scriptOf(text: string): Script | null {
  if (!ARABIC_SCRIPT.test(text)) return null;
  if (SINDHI.test(text)) return 'lateef';
  if (URDU.test(text) || PERSIAN.test(text)) return 'nastaliq';
  return 'naskh';
}

/**
 * Pure: the text in paragraphs that keep their own direction, so a post that mixes an English line with a Sindhi
 * verse lays out each the right way. Blank and neutral lines (only digits, emoji, punctuation) join the run above, or
 * the first run when they come first. Right-to-left runs get the text's script.
 */
export function runs(text: string): Run[] {
  const script = scriptOf(text);
  const out: Run[] = [];
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
      out.push({ text: [...pending, line].join('\n'), dir, script: dir === 'rtl' ? script : null });
      pending = [];
    }
  }
  if (!out.length) return [{ text, dir: 'ltr', script: null }];
  return out;
}
