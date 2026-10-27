import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

type Props = { size?: 'small' | 'large'; tone?: 'default' | 'onPrimary'; className?: string };

/** Spinning arc, identical on iOS and Android (ActivityIndicator differs per platform). */
export function Spinner({ size = 'small', tone = 'default', className = '' }: Props) {
  const [turn] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const dims = size === 'large' ? 'h-8 w-8 border-[3px]' : 'h-5 w-5 border-2';
  const colour = tone === 'onPrimary' ? 'border-white/30 border-t-white' : 'border-primary/25 border-t-primary dark:border-primary-dark/25 dark:border-t-primary-dark';
  // Layout classes (padding, margins) go on the wrapper so the circle itself never stretches.
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading" className={`items-center justify-center ${className}`}>
      <Animated.View className={`rounded-full ${dims} ${colour}`} style={{ transform: [{ rotate }] }} />
    </View>
  );
}
