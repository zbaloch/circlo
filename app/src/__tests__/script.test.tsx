import { render, screen } from '@testing-library/react-native';

import { ContentText } from '@/components/content-text';
import { fontClass } from '@/components/ui/text';
import { runs, scriptOf, textDirection } from '@/lib/script';

jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

// Samples (short, everyday phrases).
const SINDHI = 'دل شڪستو نہ ٿي'; // ڪ and ٿ are only Sindhi
const URDU = 'آپ کیسے ہیں؟ میں ٹھیک ہوں'; // ٹ and ں are Urdu
const PERSIAN = 'حال شما چطور است؟ خیلی ممنون'; // چ and ی, none of Urdu's or Sindhi's own letters
const ARABIC = 'كيف حالك؟ أنا بخير، شكرا';

describe('which way text runs', () => {
  it('Arabic-script and Hebrew are right to left; Latin, Cyrillic, Greek, Chinese, Japanese and Korean left to right', () => {
    for (const t of [SINDHI, URDU, PERSIAN, ARABIC, 'שלום']) expect([t, textDirection(t)]).toEqual([t, 'rtl']);
    for (const t of ['Hello', 'Привет', 'Γειά', '你好', 'こんにちは', '안녕하세요']) expect([t, textDirection(t)]).toEqual([t, 'ltr']);
  });

  it('goes by the first real letter, like dir="auto": digits, emoji and punctuation don’t count', () => {
    expect(textDirection('2026 ✨ ' + SINDHI)).toBe('rtl');
    expect(textDirection('😀 Hello ' + SINDHI)).toBe('ltr');
    expect(textDirection('123 !!')).toBeNull();
  });
});

describe('which font a script gets', () => {
  it('Naskh for Sindhi and Arabic, Nastaliq for Urdu and Persian, the usual fonts for everything else', () => {
    expect(scriptOf(SINDHI)).toBe('naskh');
    expect(scriptOf(ARABIC)).toBe('naskh');
    expect(scriptOf(URDU)).toBe('nastaliq');
    expect(scriptOf(PERSIAN)).toBe('nastaliq');
    for (const t of ['Hello', 'Привет', '你好', '안녕하세요']) expect(scriptOf(t)).toBeNull();
  });

  it('swaps the Inter family for the script’s, keeping the weight', () => {
    expect(fontClass('text-base font-bold', 'naskh')).toBe('font-naskh-bold text-base');
    expect(fontClass('text-base', 'nastaliq')).toBe('font-nastaliq text-base');
    expect(fontClass('text-base font-semibold')).toBe('font-sans-semibold text-base');
  });
});

describe('paragraphs', () => {
  it('splits a mixed post into runs that keep their own direction; blank and neutral lines join the run above', () => {
    expect(runs(`Shah Latif's verse:\n\n${SINDHI}\n${SINDHI}\n123\nThanks!`)).toEqual([
      { text: "Shah Latif's verse:\n", dir: 'ltr', script: null },
      { text: `${SINDHI}\n${SINDHI}\n123`, dir: 'rtl', script: 'naskh' },
      { text: 'Thanks!', dir: 'ltr', script: null },
    ]);
  });

  it('draws Sindhi right-aligned in Noto Naskh Arabic, and English as before', async () => {
    await render(<ContentText text={`Hello\n${SINDHI}`} className="text-base text-ink" />);
    const english = screen.getByText('Hello');
    const sindhi = screen.getByText(SINDHI);
    expect(english.props.className).not.toMatch(/text-right|font-naskh/);
    expect(sindhi.props.className).toMatch(/text-right/);
    expect(sindhi.props.className).toMatch(/font-naskh/);
  });

  it('keeps the blank line between paragraphs (a trailing line break alone draws nothing)', async () => {
    await render(<ContentText text={`Hello\n\n${SINDHI}`} className="text-base" />);
    expect(screen.getByText('Hello\n​')).toBeTruthy();
  });

  it('gives Nastaliq (Urdu, Persian) the extra line height its tall letters need', async () => {
    await render(<ContentText text={URDU} className="text-[15px] leading-5 text-ink" />);
    const urdu = screen.getByText(URDU);
    expect(urdu.props.className).toMatch(/font-nastaliq/);
    expect(urdu.props.className).not.toMatch(/leading-5/);
    expect(urdu.props.className).toMatch(/leading-8/);
  });
});
