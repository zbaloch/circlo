import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CircloWordmark } from './circlo-mark';
import { DrawerAvatarButton } from './ui/header';

/** Home header: your avatar (opens the drawer) on the left, the Circlo wordmark centred. */
export function HomeHeader() {
  return (
    <SafeAreaView edges={['top']} className="border-b border-border bg-surface dark:border-border-dark dark:bg-surface-dark">
      <View className="h-[53px] flex-row items-center px-2">
        <View className="w-10 items-center">
          <DrawerAvatarButton />
        </View>
        <View className="flex-1 items-center">
          <CircloWordmark height={24} />
        </View>
        <View className="w-10" />
      </View>
    </SafeAreaView>
  );
}
