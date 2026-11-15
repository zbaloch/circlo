import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Sheet } from '@/components/audience-sheet';
import { IconButton } from '@/components/icon-button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { monthGrid, monthTitle } from '@/lib/desk';
import { usePalette } from '@/theme/use-palette';

const DAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type Props = {
  visible: boolean;
  value: string | null;
  today: string;
  onPick: (day: string) => void;
  onClose: () => void;
};

/** A month calendar for picking a due date. Today is outlined, the chosen day filled. */
export function DateSheet(props: Props) {
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title="Due date">
      {/* Mounted only while open, so it opens on the chosen month each time. */}
      {props.visible ? <Calendar {...props} /> : null}
    </Sheet>
  );
}

function Calendar({ value, today, onPick, onClose }: Props) {
  const palette = usePalette();
  const start = value ?? today;
  const [ym, setYm] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  const shift = (n: number) => setYm(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (((m + n) % 12) + 12) % 12 }));

  return (
    <View className="px-4 pb-4">
      <View className="flex-row items-center justify-between pb-2">
        <IconButton accessibilityLabel="Previous month" onPress={() => shift(-1)}>
          <Icon name="chevron-back" size={22} color={palette.ink} />
        </IconButton>
        <Text className="text-base font-bold text-ink dark:text-ink-dark">{monthTitle(ym.y, ym.m)}</Text>
        <IconButton accessibilityLabel="Next month" onPress={() => shift(1)}>
          <Icon name="chevron-forward" size={22} color={palette.ink} />
        </IconButton>
      </View>
      <View className="flex-row">
        {DAY_HEADERS.map((d, i) => (
          <Text key={i} className="flex-1 pb-1 text-center text-[13px] font-semibold text-muted dark:text-muted-dark">
            {d}
          </Text>
        ))}
      </View>
      {monthGrid(ym.y, ym.m).map((week, w) => (
        <View key={w} className="flex-row">
          {week.map((day, i) =>
            day ? (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={day}
                accessibilityState={{ selected: day === value }}
                onPress={() => {
                  onPick(day);
                  onClose();
                }}
                className="flex-1 items-center py-1">
                <View
                  className={`h-10 w-10 items-center justify-center rounded-full ${
                    day === value ? 'bg-primary dark:bg-primary-dark' : day === today ? 'border border-primary dark:border-primary-dark' : ''
                  }`}>
                  <Text className={day === value ? 'font-bold text-on-primary dark:text-on-primary-dark' : 'text-ink dark:text-ink-dark'}>{Number(day.slice(8))}</Text>
                </View>
              </Pressable>
            ) : (
              <View key={`x${i}`} className="flex-1" />
            ),
          )}
        </View>
      ))}
    </View>
  );
}
