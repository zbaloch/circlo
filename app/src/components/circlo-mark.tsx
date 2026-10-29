import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';
import { usePalette } from '@/theme/use-palette';

// Geometry from the wordmark brand pack (logo/svg): "circlo" with a dotted final "o". Letters and ring are ink on
// light and white on dark; only the dot is sky (sky-500 on light, sky-400 on dark).

// circlo-symbol-*.svg, 200 × 200: the dotted "o" alone.
const SYMBOL_RING = 'M0 100a100 100 0 1 0 200 0a100 100 0 1 0 -200 0ZM35.96 100a64.04 64.04 0 1 0 128.09 0a64.04 64.04 0 1 0 -128.09 0Z';
const SYMBOL_DOT = { cx: 100, cy: 100, r: 31.46 };

// circlo-wordmark-*.svg, 333.23 × 101.6: "circl" outlined from Inter Display SemiBold, then the ring and dot.
const WORDMARK_SIZE = { w: 333.23, h: 101.6 };
const WORDMARK_LETTERS =
  'M34.4 101.6C52.2 101.6 65.13 90.13 66.33 74.73H49.73C48.13 82.53 43.4 87.6 34.6 87.6C23.53 87.6 17 78.73 17 64.87C17 50.93 23.6 42 34.6 42C43.33 42 48.6 47.27 49.87 54.8H66.33C64.87 39.13 52.07 28 34.4 28C13.8 28 0 43.13 0 64.87C0 86.6 13.8 101.6 34.4 101.6ZM74.87 100H91.67V29.6H74.87ZM83.27 19.13C89 19.13 93.34 15 93.34 9.53C93.34 4.13 89 0 83.27 0C77.54 0 73.2 4.13 73.2 9.53C73.2 15 77.54 19.13 83.27 19.13ZM103.87 100H120.67V60.13C120.67 49.13 126.87 43.6 134.87 43.6C138.21 43.6 141.54 43.93 142.81 44.13V29.2C141.47 29.07 139.61 28.93 137.34 28.93C128.27 28.93 122.87 33.2 120.27 41.27H120.07V29.6H103.87ZM180.87 101.6C198.67 101.6 211.61 90.13 212.81 74.73H196.21C194.61 82.53 189.87 87.6 181.07 87.6C170.01 87.6 163.47 78.73 163.47 64.87C163.47 50.93 170.07 42 181.07 42C189.81 42 195.07 47.27 196.34 54.8H212.81C211.34 39.13 198.54 28 180.87 28C160.27 28 146.47 43.13 146.47 64.87C146.47 86.6 160.27 101.6 180.87 101.6ZM238.14 0.67H221.34V100H238.14Z';
const WORDMARK_RING = 'M251.86 57.49a40.69 40.69 0 1 0 81.37 0a40.69 40.69 0 1 0 -81.37 0ZM266.49 57.49a26.06 26.06 0 1 0 52.11 0a26.06 26.06 0 1 0 -52.11 0Z';
const WORDMARK_DOT = { cx: 292.54, cy: 57.49, r: 12.8 };

const PIXELS = { sm: 28, lg: 96 };

/** Brand colours for the current scheme: ink letters + sky-500 dot on light, white letters + sky-400 dot on dark. */
function useBrand() {
  const { dark } = usePalette();
  return dark ? { ink: '#FFFFFF', dot: colors.brand['accent-dark'] } : { ink: colors.brand.ink, dot: colors.brand.accent };
}

/** The dotted "o" alone, where only a square fits (empty states, small spaces). */
export function CircloSymbol({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const { ink, dot } = useBrand();
  const px = PIXELS[size];
  return (
    <Svg width={px} height={px} viewBox="0 0 200 200" accessible accessibilityRole="image" accessibilityLabel="Circlo">
      <Path d={SYMBOL_RING} fill={ink} fillRule="evenodd" />
      <Circle {...SYMBOL_DOT} fill={dot} />
    </Svg>
  );
}

/** The "circlo" wordmark: the logo itself (top bar, welcome screen). */
export function CircloWordmark({ height = 24 }: { height?: number }) {
  const { ink, dot } = useBrand();
  return (
    <Svg
      width={(height * WORDMARK_SIZE.w) / WORDMARK_SIZE.h}
      height={height}
      viewBox={`0 0 ${WORDMARK_SIZE.w} ${WORDMARK_SIZE.h}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Circlo">
      <Path d={WORDMARK_LETTERS} fill={ink} fillRule="evenodd" />
      <Path d={WORDMARK_RING} fill={ink} fillRule="evenodd" />
      <Circle {...WORDMARK_DOT} fill={dot} />
    </Svg>
  );
}
