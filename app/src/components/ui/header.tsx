import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useNavigation } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';

import { Avatar } from '../avatar';
import { Text } from './text';

type Props = { title?: string; left: ReactNode; right?: ReactNode };

/** Header bar shared by every screen (X style): no shadow, hairline divider, bold title, same on iOS and Android. */
export function HeaderBar({ title, left, right }: Props) {
  return (
    <SafeAreaView edges={['top']} className="border-b border-border bg-surface dark:border-border-dark dark:bg-surface-dark">
      <View className="h-[53px] flex-row items-center gap-3 px-2">
        <View className="w-10 items-center">{left}</View>
        <Text accessibilityRole="header" numberOfLines={1} className="flex-1 text-[19px] font-bold text-ink dark:text-ink-dark">
          {title}
        </Text>
        <View className="min-w-10 flex-row items-center justify-end">{right}</View>
      </View>
    </SafeAreaView>
  );
}

/** Back arrow: previous screen, or Home when there is none (e.g. opened from a link). */
export function BackButton() {
  const navigation = useNavigation();
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      onPress={() => (navigation.canGoBack() ? navigation.goBack() : router.replace('/'))}
      className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-raised dark:active:bg-surface-raised-dark">
      <Ionicons name="arrow-back" size={22} color={palette.ink} />
    </Pressable>
  );
}

/** Your avatar; opens the side drawer (top-level tab screens, as on X). */
export function DrawerAvatarButton() {
  const navigation = useNavigation();
  const session = useSession();
  const handle = session.status === 'signedIn' ? session.account.handle : undefined;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Open menu" hitSlop={8} onPress={() => navigation.dispatch({ type: 'OPEN_DRAWER' })} className="active:opacity-70">
      <Avatar size="sm" name={handle} />
    </Pressable>
  );
}
