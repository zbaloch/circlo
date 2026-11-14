import { render, screen } from '@testing-library/react-native';

import { ContentText } from '@/components/content-text';
import { fontClass } from '@/components/ui/text';
import { runs, textDirection, usesSystemFont } from '@/lib/script';

jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

// Samples (short, everyday phrases).
const SINDHI = 'دل شڪستو نہ ٿي';
const URDU = 'آپ کیسے ہیں؟ میں ٹھیک ہوں';
const PERSIAN = 'حال شما چطور است؟ خیلی ممنون';
const ARABIC = 'كيف حالك؟ أنا بخير، شكرا';
const HINDI = 'आप कैसे हैं?';
const JAPANESE = 'こんにちは';
const KOREAN = '안녕하세요';
const CHINESE = '你好';

describe('which way text runs', () => {
  it('Arabic-script and Hebrew are right to left; Latin, Cyrillic, Greek, Chinese, Japanese and Korean left to right', () => {
    for (const t of [SINDHI, URDU, PERSIAN, ARABIC, 'שלום']) expect([t, textDirection(t)]).toEqual([t, 'rtl']);
    for (const t of ['Hello', 'Привет', 'Γειά', CHINESE, JAPANESE, KOREAN, HINDI]) expect([t, textDirection(t)]).toEqual([t, 'ltr']);
  });

  it('goes by the first real letter, like dir="auto": digits, emoji and punctuation don’t count', () => {
    expect(textDirection('2026 ✨ ' + SINDHI)).toBe('rtl');
    expect(textDirection('😀 Hello ' + SINDHI)).toBe('ltr');
    expect(textDirection('123 !!')).toBeNull();
  });
});

describe('which font text gets', () => {
  it('Inter for the languages it covers (Latin, Greek, Cyrillic), the phone’s own fonts for everything else', () => {
    for (const t of ['Hello', 'Café, naïve, Łódź', 'Tiếng Việt', 'Привет', 'Γειά σου', '2026 ✨ !!', '😀']) expect([t, usesSystemFont(t)]).toEqual([t, false]);
    for (const t of [SINDHI, URDU, PERSIAN, ARABIC, 'שלום', HINDI, JAPANESE, KOREAN, CHINESE, 'สวัสดี']) expect([t, usesSystemFont(t)]).toEqual([t, true]);
    // One letter Inter hasn't got is enough: the phone's font has the Latin letters too.
    expect(usesSystemFont(`Hello ${CHINESE}`)).toBe(true);
  });

  it('drops the Inter family for the phone’s font, keeping the weight', () => {
    expect(fontClass('text-base font-bold', true)).toBe('font-bold text-base');
    expect(fontClass('text-base', true)).toBe('font-normal text-base');
    expect(fontClass('font-black text-ink', true)).toBe('font-extrabold text-ink');
    expect(fontClass('text-base font-semibold')).toBe('font-sans-semibold text-base');
    expect(fontClass('text-base font-semibold', false)).toBe('font-sans-semibold text-base');
  });
});

describe('paragraphs', () => {
  it('splits a mixed post into runs that keep their own direction; blank and neutral lines join the run above', () => {
    expect(runs(`Shah Latif's verse:\n\n${SINDHI}\n${SINDHI}\n123\nThanks!`)).toEqual([
      { text: "Shah Latif's verse:\n", dir: 'ltr', system: false },
      { text: `${SINDHI}\n${SINDHI}\n123`, dir: 'rtl', system: true },
      { text: 'Thanks!', dir: 'ltr', system: false },
    ]);
  });

  it('each run gets the phone’s font only if it needs it', () => {
    expect(runs(`${HINDI}\nHello`)).toEqual([{ text: `${HINDI}\nHello`, dir: 'ltr', system: true }]);
    expect(runs(`Hello\n${JAPANESE}`)).toEqual([{ text: `Hello\n${JAPANESE}`, dir: 'ltr', system: true }]);
  });

  it('draws Sindhi right-aligned in the phone’s font, at the size given, and English in Inter as before', async () => {
    await render(<ContentText text={`Hello\n${SINDHI}`} className="text-[15px] leading-5 text-ink" />);
    const english = screen.getByText('Hello');
    const sindhi = screen.getByText(SINDHI);
    expect(english.props.className).toMatch(/font-sans/);
    expect(english.props.className).not.toMatch(/text-right/);
    expect(english.props.className).toMatch(/text-\[15px\] leading-5/);
    expect(sindhi.props.className).toMatch(/text-right/);
    expect(sindhi.props.className).not.toMatch(/font-sans/);
    expect(sindhi.props.className).toMatch(/text-\[15px\]/);
    // The colour stays.
    expect(sindhi.props.className).toMatch(/text-ink/);
  });

  it('draws Urdu, Japanese and Hindi in the phone’s fonts', async () => {
    for (const t of [URDU, JAPANESE, HINDI]) {
      await render(<ContentText text={t} className="text-base" />);
      expect(screen.getByText(t).props.className).not.toMatch(/font-sans/);
    }
  });

  it('keeps the blank line between paragraphs (a trailing line break alone draws nothing)', async () => {
    await render(<ContentText text={`Hello\n\n${SINDHI}`} className="text-base" />);
    expect(screen.getByText('Hello\n​')).toBeTruthy();
  });
});
