import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from 'expo-router/tabs';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePalette } from '@/theme/use-palette';

type IconName = ComponentProps<typeof Ionicons>['name'];
export type TabSpec = { name: string; label: string; icon: IconName; iconActive: IconName };

/**
 * Icon-only bottom bar (X style): hairline top border, filled icon for the current tab, same on iOS and Android.
 * `dots` marks tabs with something new (a small primary dot on the icon).
 */
export function TabBar({
  state,
  emitter,
  navigateToTab,
  tabs,
  dots = {},
}: BottomTabBarProps & { tabs: TabSpec[]; dots?: Partial<Record<string, boolean>> }) {
  const palette = usePalette();
  return (
    <SafeAreaView edges={['bottom']} className="border-t border-border bg-surface dark:border-border-dark dark:bg-surface-dark">
      <View accessibilityRole="tablist" className="h-[52px] flex-row">
        {state.routes.map((route, index) => {
          const tab = tabs.find((t) => t.name === route.name);
          if (!tab) return null;
          const focused = state.index === index;
          const onPress = () => {
            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigateToTab(route.key);
          };
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={dots[tab.name] ? `${tab.label}, new` : tab.label}
              accessibilityState={{ selected: focused }}
              onPress={onPress}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              className="flex-1 items-center justify-center active:opacity-60">
              <View>
                <Ionicons name={focused ? tab.iconActive : tab.icon} size={26} color={focused ? palette.ink : palette.muted} />
                {dots[tab.name] ? (
                  <View className="absolute -right-0.5 top-0 h-3 w-3 rounded-full border-2 border-surface bg-primary dark:border-surface-dark dark:bg-primary-dark" />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
