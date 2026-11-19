import { Pressable, ScrollView, View } from 'react-native';

import { Section } from '@/components/settings-ui';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { setTheme, THEME_CHOICES, type ThemeChoice, useThemeChoice } from '@/lib/theme';
import { usePalette } from '@/theme/use-palette';

const NOTES: Record<ThemeChoice, string> = {
  system: 'Light or dark, the way your device is set, changing when it does.',
  light: 'Always light.',
  dark: 'Always dark.',
};

/**
 * Display (owner request 2026-11-19): the theme, as X does it. Follow the device (the default), Light or Dark; a
 * setting of this device only.
 */
export default function DisplaySettingsScreen() {
  const choice = useThemeChoice();
  const palette = usePalette();
  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="pb-10">
      <Section title="Theme">
        <View accessibilityRole="radiogroup">
          {THEME_CHOICES.map((t) => {
            const on = t.value === choice;
            return (
              <Pressable
                key={t.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={t.label}
                onPress={() => void setTheme(t.value)}
                className="flex-row items-center gap-4 px-4 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
                <View className="flex-1 gap-0.5">
                  <Text className="text-[15px] font-semibold text-ink dark:text-ink-dark">{t.label}</Text>
                  <Text className="text-[13px] leading-[18px] text-muted dark:text-muted-dark">{NOTES[t.value]}</Text>
                </View>
                <Icon name={on ? 'radio-button-on-outline' : 'ellipse-outline'} size={22} color={on ? palette.primary : palette.muted} />
              </Pressable>
            );
          })}
        </View>
      </Section>
      <Text className="px-4 pt-4 text-[13px] leading-[18px] text-muted dark:text-muted-dark">
        This only changes Circlo on this device.
      </Text>
    </ScrollView>
  );
}
