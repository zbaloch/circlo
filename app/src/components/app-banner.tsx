import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { CircloSymbol } from '@/components/circlo-mark';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { appBannerClosed, appBannerTarget, browserInfo, closeAppBanner, type AppBannerTarget } from '@/lib/app-banner';
import { APP_BANNER_ENABLED } from '@/lib/features';
import { APP_STORE_URL, openLink } from '@/lib/links';
import { usePalette } from '@/theme/use-palette';

/**
 * Above the web app on an iPhone or iPad: "Get Circlo for iPhone" with a Get button to the App Store and a close
 * button, remembered on this device. Never shown in the phone apps or on a computer.
 */
export function AppBanner({ enabled = APP_BANNER_ENABLED }: { enabled?: boolean }) {
  const palette = usePalette();
  const [target] = useState<AppBannerTarget>(() => appBannerTarget({ enabled, os: Platform.OS, ...browserInfo() }));
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!target) return;
    let live = true;
    appBannerClosed().then((closed) => {
      if (live && !closed) setShow(true);
    });
    return () => {
      live = false;
    };
  }, [target]);

  if (!target || !show) return null;

  const close = () => {
    setShow(false);
    void closeAppBanner();
  };

  return (
    <View className="flex-row items-center gap-3 border-b border-border bg-surface-raised px-3 py-2 dark:border-border-dark dark:bg-surface-raised-dark">
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={8}>
        <Icon name="close" size={20} color={palette.muted} />
      </Pressable>
      <CircloSymbol />
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-ink dark:text-ink-dark">Get Circlo for iPhone</Text>
        <Text className="text-[13px] text-muted dark:text-muted-dark">Free on the App Store</Text>
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => openLink(APP_STORE_URL)}
        className="rounded-full bg-primary px-4 py-1.5 active:opacity-80 dark:bg-primary-dark">
        <Text className="text-[15px] font-semibold text-on-primary dark:text-on-primary-dark">Get</Text>
      </Pressable>
    </View>
  );
}
