import { fitToContent } from '@/components/ui/auto-grow.web';
import { typingAtEnd } from '@/components/follow-caret';

describe('fitToContent (web multiline fields)', () => {
  it('sizes the textarea to its text, so it grows line by line instead of scrolling inside', () => {
    const heights: string[] = [];
    const el = {
      scrollHeight: 0,
      style: {
        set height(v: string) {
          heights.push(v);
          // Measuring happens at height auto; the content then needs 132px.
          if (v === 'auto') el.scrollHeight = 132;
        },
      },
    };
    fitToContent(el as unknown as HTMLElement);
    expect(heights).toEqual(['auto', '132px']);
  });

  it('ignores a missing element', () => {
    expect(() => fitToContent(null)).not.toThrow();
  });
});

describe('typingAtEnd (compose and reply follow the line being typed)', () => {
  it('follows while typing at the end, not while editing earlier text', () => {
    expect(typingAtEnd(42, 42)).toBe(true);
    expect(typingAtEnd(10, 42)).toBe(false);
  });
});
