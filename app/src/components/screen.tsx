import type { ReactNode } from 'react';
import { View } from 'react-native';

export function Screen({ children }: { children: ReactNode }) {
  return <View className="flex-1 bg-surface dark:bg-surface-dark">{children}</View>;
}
