import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The web app's centred column, about as wide as X's timeline, with a hairline on each side. Every width class is
 * `web:`-only, so on phones this is a plain full-screen view.
 */
export const FRAME_CLASS =
  'flex-1 bg-surface dark:bg-surface-dark web:w-full web:max-w-[600px] web:self-center web:border-x web:border-border web:dark:border-border-dark';

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <View className={FRAME_CLASS}>{children}</View>
    </View>
  );
}
