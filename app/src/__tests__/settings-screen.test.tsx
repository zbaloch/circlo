import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import SettingsScreen, { SETTINGS_PAGES } from '@/app/settings/index';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

describe('Settings and privacy', () => {
  it('lists one link per area, Devices first, as on X', () => {
    expect(SETTINGS_PAGES.map((p) => p.title)).toEqual(['Devices', 'Your account', 'Storage', 'Notifications', 'Privacy and safety', 'About Circlo']);
    expect(SETTINGS_PAGES.map((p) => p.href)).toEqual(['/devices', '/settings/account', '/settings/storage', '/settings/notifications', '/settings/privacy', '/settings/about']);
    for (const p of SETTINGS_PAGES) expect(p.subtitle).toBeTruthy();
  });

  it('opens the page a link is for', async () => {
    await render(<SettingsScreen />);
    fireEvent.press(screen.getByRole('link', { name: /Privacy and safety/ }));
    expect(router.push).toHaveBeenCalledWith('/settings/privacy');
    fireEvent.press(screen.getByRole('link', { name: /Devices/ }));
    expect(router.push).toHaveBeenCalledWith('/devices');
  });
});
