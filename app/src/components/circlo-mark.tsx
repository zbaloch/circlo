import { View } from 'react-native';
import { Text } from '@/components/ui/text';

type Props = { size?: 'sm' | 'lg'; wordmark?: boolean };

const RINGS = {
  sm: ['h-7 w-7 border-[2.5px]', 'h-[18px] w-[18px] border-[2.5px]', 'h-2 w-2'],
  lg: ['h-24 w-24 border-[6px]', 'h-[60px] w-[60px] border-[6px]', 'h-6 w-6'],
};

/** Placeholder logo until a real one exists: concentric rings (circles) plus the "Circlo" wordmark. */
export function CircloMark({ size = 'sm', wordmark = false }: Props) {
  const [outer, middle, core] = RINGS[size];
  return (
    <View className="flex-row items-center gap-2" accessible accessibilityRole="image" accessibilityLabel="Circlo">
      <View className={`items-center justify-center rounded-full border-primary dark:border-primary-dark ${outer}`}>
        <View className={`items-center justify-center rounded-full border-primary dark:border-primary-dark ${middle}`}>
          <View className={`rounded-full bg-primary dark:bg-primary-dark ${core}`} />
        </View>
      </View>
      {wordmark && (
        <Text className={`font-bold text-ink dark:text-ink-dark ${size === 'lg' ? 'text-4xl' : 'text-xl'}`}>Circlo</Text>
      )}
    </View>
  );
}
