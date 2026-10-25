import { render, screen } from '@testing-library/react-native';

import { TABS } from '@/app/(tabs)/_layout';
import HomeScreen from '@/app/(tabs)/index';
import MessagesScreen from '@/app/(tabs)/messages';
import SearchScreen from '@/app/(tabs)/search';
import { DRAWER_ITEMS } from '@/components/app-drawer';

// The full drawer + tabs navigator needs Reanimated's native runtime, which doesn't load under jest-expo;
// it is checked on the emulator (docs/PROGRESS.md "Needs manual check").
describe('app shell', () => {
  it('has exactly the four icon-only tabs from PLAN.md 2A, each with a screen-reader label', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Home', 'Search', 'Notifications', 'Messages']);
    for (const t of TABS) {
      expect(t.icon).toBeTruthy();
      expect(t.iconActive).toBeTruthy();
    }
  });

  it('drawer has Profile, Circles, Devices, Settings and Recovery phrase', () => {
    expect(DRAWER_ITEMS.map((i) => i.label)).toEqual(['Profile', 'Circles', 'Devices', 'Settings', 'Recovery phrase']);
  });

  it('Home shows the empty state and a labelled compose button', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Your timeline is quiet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite your first friend' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compose post' })).toBeTruthy();
  });

  it('Messages has a labelled new-message button', async () => {
    await render(<MessagesScreen />);
    expect(screen.getByRole('button', { name: 'New message' })).toBeTruthy();
  });

  it('never shows a circle number to readers', async () => {
    await render(<SearchScreen />);
    expect(screen.queryByText(/circle \d+/i)).toBeNull();
  });
});
