import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';
import { usePalette } from '@/theme/use-palette';

type Props = { size?: 'sm' | 'lg'; wordmark?: boolean };

// Geometry from circlo-brand-assets/logo/svg (Halo mark, 200 × 200): a centre dot ("only me") in a ring of eight.
// Below ~32 px the brand pack's optical "small" version (bigger dots) is used.
const GEOMETRY = {
  regular: { core: 26.67, dot: 17.33, ring: [[100, 17.33], [158.45, 41.55], [182.67, 100], [158.45, 158.45], [100, 182.67], [41.55, 158.45], [17.33, 100], [41.55, 41.55]] },
  small: { core: 33.33, dot: 22.67, ring: [[100, 22.67], [154.68, 45.32], [177.33, 100], [154.68, 154.68], [100, 177.33], [45.32, 154.68], [22.67, 100], [45.32, 45.32]] },
};
const PIXELS = { sm: 28, lg: 96 };
const GAP = { sm: 'gap-2', lg: 'gap-6' };

// "circlo" wordmark (outlined Inter Display Bold), 321.69 × 100.
const WORDMARK =
  'M34.71 100C53.11 100 66.34 88.41 67.19 72.43H48.4C47.15 79.7 42.76 84.41 34.97 84.41C25.28 84.41 19.45 76.49 19.45 63.92C19.45 51.28 25.21 43.29 34.97 43.29C42.7 43.29 47.54 48.07 48.53 55.14H67.19C65.95 39.03 52.91 27.7 34.71 27.7C13.95 27.7 0 42.5 0 63.92C0 85.33 13.88 100 34.71 100ZM74.79 98.43H94.11V29.27H74.79ZM84.42 20.56C90.77 20.56 95.42 16.18 95.42 10.28C95.42 4.39 90.77 0 84.42 0C78.06 0 73.41 4.39 73.41 10.28C73.41 16.18 78.06 20.56 84.42 20.56ZM105.05 98.43H124.37V60.97C124.37 50.56 130.2 45.06 138.12 45.06C141.39 45.06 145 45.32 146.44 45.38V28.95C144.86 28.88 142.97 28.81 140.74 28.81C131.64 28.81 126.4 32.74 123.84 41.06H123.65V29.27H105.05ZM184.09 100C202.5 100 215.72 88.41 216.58 72.43H197.78C196.54 79.7 192.15 84.41 184.36 84.41C174.66 84.41 168.84 76.49 168.84 63.92C168.84 51.28 174.6 43.29 184.36 43.29C192.08 43.29 196.93 48.07 197.91 55.14H216.58C215.33 39.03 202.3 27.7 184.09 27.7C163.33 27.7 149.39 42.5 149.39 63.92C149.39 85.33 163.27 100 184.09 100ZM243.49 0.85H224.18V98.43H243.49ZM286.52 100C307.54 100 321.69 85.59 321.69 63.92C321.69 42.24 307.54 27.7 286.52 27.7C265.57 27.7 251.42 42.24 251.42 63.92C251.42 85.59 265.57 100 286.52 100ZM286.52 84.35C277.16 84.35 270.87 76.75 270.87 63.92C270.87 51.02 277.22 43.35 286.52 43.35C295.89 43.35 302.24 51.02 302.24 63.92C302.24 76.75 295.95 84.35 286.52 84.35Z';

/** Brand colours for the current scheme: ink dots + sky-500 centre on light, white dots + sky-400 centre on dark. */
function useBrand() {
  const { dark } = usePalette();
  return dark
    ? { dots: '#FFFFFF', centre: colors.brand['accent-dark'] }
    : { dots: colors.brand.ink, centre: colors.brand.accent };
}

/** The Halo mark, optionally with the "circlo" wordmark beside it (brand lockup proportions). */
export function CircloMark({ size = 'sm', wordmark = false }: Props) {
  const { dots, centre } = useBrand();
  const px = PIXELS[size];
  const g = px < 32 ? GEOMETRY.small : GEOMETRY.regular;
  return (
    <View className={`flex-row items-center ${GAP[size]}`} accessible accessibilityRole="image" accessibilityLabel="Circlo">
      <Svg width={px} height={px} viewBox="0 0 200 200">
        <Circle cx={100} cy={100} r={g.core} fill={centre} />
        {g.ring.map(([cx, cy]) => (
          <Circle key={`${cx},${cy}`} cx={cx} cy={cy} r={g.dot} fill={dots} />
        ))}
      </Svg>
      {wordmark ? <CircloWordmark height={px / 2} /> : null}
    </View>
  );
}

/** The "circlo" wordmark alone, in ink on light and white on dark. Decorative: pair it with a labelled mark or text. */
export function CircloWordmark({ height = 40 }: { height?: number }) {
  const { dots } = useBrand();
  return (
    <Svg width={(height * 321.69) / 100} height={height} viewBox="0 0 321.69 100">
      <Path d={WORDMARK} fill={dots} />
    </Svg>
  );
}
