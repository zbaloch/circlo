import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { usePalette } from '@/theme/use-palette';

const R = 10;
const C = 2 * Math.PI * R;

/** Twitter-style character counter ring; shows the remaining count in the last 20 characters. */
export function CharRing({ used, limit }: { used: number; limit: number }) {
  const palette = usePalette();
  const left = limit - used;
  const fraction = Math.min(1, used / limit);
  const color = left < 0 ? palette.danger : left <= 20 ? '#E0A100' : palette.primary;
  return (
    <View accessibilityLabel={`${left} characters left`} className="flex-row items-center gap-1">
      {left <= 20 ? <Text className={left < 0 ? 'text-sm text-danger dark:text-danger-dark' : 'text-sm text-muted dark:text-muted-dark'}>{left}</Text> : null}
      <Svg width={26} height={26} viewBox="0 0 26 26">
        <Circle cx={13} cy={13} r={R} stroke={palette.border} strokeWidth={2.5} fill="none" />
        <Circle
          cx={13}
          cy={13}
          r={R}
          stroke={color}
          strokeWidth={2.5}
          fill="none"
          strokeDasharray={`${C * fraction} ${C}`}
          strokeLinecap="round"
          transform="rotate(-90 13 13)"
        />
      </Svg>
    </View>
  );
}
