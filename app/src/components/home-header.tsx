import { useNavigation } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from './avatar';
import { HalqoMark } from './halqo-mark';
import { IconButton } from './icon-button';

/** Home header: your avatar (opens the drawer) on the left, Halqo mark centred. */
export function HomeHeader() {
  const navigation = useNavigation();
  return (
    <SafeAreaView edges={['top']} className="border-b border-border bg-surface dark:border-border-dark dark:bg-surface-dark">
      <View className="h-12 flex-row items-center px-3">
        <IconButton accessibilityLabel="Open menu" onPress={() => navigation.dispatch({ type: 'OPEN_DRAWER' })}>
          <Avatar size="sm" />
        </IconButton>
        <View className="flex-1 items-center">
          <HalqoMark />
        </View>
        <View className="w-12" />
      </View>
    </SafeAreaView>
  );
}
