import { ScrollView, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Segmented } from '@/components/ui/segmented';
import { Text } from '@/components/ui/text';
import { DARK_THEMES, setDarkTheme, setTheme, THEME_CHOICES, useDarkTheme, useThemeChoice } from '@/lib/theme';
import { usePalette } from '@/theme/use-palette';

/**
 * Display (owner requests 2026-11-19), laid out like Bluesky's Appearance: the colour mode (System, the default; Light;
 * Dark), then, whenever the app can be dark, which dark theme: Dim (classic Twitter's soft navy) or Dark. Settings of
 * this device only.
 */
export default function DisplaySettingsScreen() {
  const choice = useThemeChoice();
  const darkTheme = useDarkTheme();
  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="gap-7 px-4 pb-10 pt-5">
      <Group icon="phone-portrait-outline" title="Color mode">
        <Segmented accessibilityLabel="Color mode" options={THEME_CHOICES} value={choice} onChange={(c) => void setTheme(c)} />
      </Group>
      {/* Light never shows a dark theme, so there's nothing to choose. */}
      {choice !== 'light' ? (
        <Group icon="moon-outline" title="Dark theme">
          <Segmented accessibilityLabel="Dark theme" options={DARK_THEMES} value={darkTheme} onChange={(t) => void setDarkTheme(t)} />
        </Group>
      ) : null}
    </ScrollView>
  );
}

function Group({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <Icon name={icon} size={22} color={palette.ink} />
        <Text accessibilityRole="header" className="text-[17px] font-semibold text-ink dark:text-ink-dark">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}
