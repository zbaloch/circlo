import type { Href } from 'expo-router';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { openLink } from '@/lib/links';
import { usePalette } from '@/theme/use-palette';

/** A settings group: small heading, rows separated by a hairline (X style). */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View className="border-b border-border dark:border-border-dark">
      {title ? (
        <Text accessibilityRole="header" className="px-4 pb-1 pt-5 text-xl font-extrabold text-ink dark:text-ink-dark">
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function Row({ title, subtitle, danger = false, children }: { title?: string; subtitle?: string; danger?: boolean; children?: ReactNode }) {
  return (
    <View className="flex-row items-center gap-4 px-4 py-3">
      <View className="flex-1 gap-0.5">
        {title ? <Text className={`text-[15px] font-semibold ${danger ? 'text-danger dark:text-danger-dark' : 'text-ink dark:text-ink-dark'}`}>{title}</Text> : null}
        {subtitle ? <Text className="text-[13px] leading-[18px] text-muted dark:text-muted-dark">{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** A row that opens another screen: optional icon, title, one-line description and a chevron (X's settings list). */
export function NavRow({ icon, title, subtitle, href }: { icon?: IconName; title: string; subtitle?: string; href: Href }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={() => router.push(href)}
      className="flex-row items-center gap-4 px-4 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
      {icon ? <Icon name={icon} size={22} color={palette.muted} /> : null}
      <View className="flex-1 gap-0.5">
        <Text className="text-[15px] font-semibold text-ink dark:text-ink-dark">{title}</Text>
        {subtitle ? <Text className="text-[13px] leading-[18px] text-muted dark:text-muted-dark">{subtitle}</Text> : null}
      </View>
      <Icon name="chevron-forward" size={18} color={palette.muted} />
    </Pressable>
  );
}

/** A row that opens one of Circlo's web pages in the browser. */
export function LinkRow({ title, url }: { title: string; url: string }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="link" onPress={() => openLink(url)} className="flex-row items-center gap-4 px-4 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
      <Text className="flex-1 text-[15px] font-semibold text-ink dark:text-ink-dark">{title}</Text>
      <Icon name="open-outline" size={18} color={palette.muted} />
    </Pressable>
  );
}
