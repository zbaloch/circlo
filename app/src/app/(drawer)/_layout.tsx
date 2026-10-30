import { Drawer } from 'expo-router/drawer';

import { AppDrawer } from '@/components/app-drawer';

/**
 * The side drawer (PLAN.md 2A app shell) wraps only the tabs, as on X: it opens from the avatar or by swiping on a tab.
 * Every other screen is pushed on the root stack above it, so a left-edge swipe there goes back (iOS) instead of
 * opening the drawer.
 */
export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <AppDrawer {...props} />}
      screenOptions={{ headerShown: false, drawerType: 'front', overlayColor: 'rgba(0,0,0,0.4)' }}>
      <Drawer.Screen name="(tabs)" />
    </Drawer>
  );
}
