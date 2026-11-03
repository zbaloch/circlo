import { svgA11y } from '@/components/ui/svg-a11y';

describe('svgA11y', () => {
  it('uses ARIA on web, so no React Native-only prop reaches the <svg> element', () => {
    expect(svgA11y('Circlo', 'web')).toEqual({ role: 'img', 'aria-label': 'Circlo' });
    expect(svgA11y(undefined, 'web')).toEqual({ 'aria-hidden': true });
  });

  it("uses React Native's accessibility props on phones", () => {
    expect(svgA11y('Circlo', 'ios')).toEqual({ accessible: true, accessibilityRole: 'image', accessibilityLabel: 'Circlo' });
    expect(svgA11y(undefined, 'android')).toEqual({ accessible: false });
  });
});
