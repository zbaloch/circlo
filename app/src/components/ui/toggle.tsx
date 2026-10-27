import { useEffect, useState } from 'react';
import { Animated, Pressable } from 'react-native';

type Props = { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; accessibilityLabel: string };

/** On/off switch drawn the same on iOS and Android (the native Switch is Material on Android). */
export function Toggle({ value, onValueChange, disabled = false, accessibilityLabel }: Props) {
  const [pos] = useState(() => new Animated.Value(value ? 1 : 0));
  useEffect(() => {
    Animated.timing(pos, { toValue: value ? 1 : 0, duration: 150, useNativeDriver: true }).start();
  }, [pos, value]);
  const translateX = pos.interpolate({ inputRange: [0, 1], outputRange: [2, 22] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      hitSlop={8}
      className={`h-[30px] w-[50px] justify-center rounded-full ${value ? 'bg-primary dark:bg-primary-dark' : 'bg-border dark:bg-border-dark'} ${disabled ? 'opacity-50' : ''}`}>
      <Animated.View className="h-[26px] w-[26px] rounded-full bg-white" style={{ transform: [{ translateX }] }} />
    </Pressable>
  );
}
