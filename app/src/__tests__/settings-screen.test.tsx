import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import SettingsScreen, { SETTINGS_PAGES, settingsPages } from '@/app/settings/index';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
let mockMe: { admin: boolean } | null = null;
jest.mock('@/lib/me', () => ({ useMe: () => mockMe }));

describe('Settings and privacy', () => {
  it('lists one link per area, Devices first, as on X', () => {
    expect(SETTINGS_PAGES.map((p) => p.title)).toEqual(['Devices', 'Your account', 'Storage', 'Display', 'Notifications', 'Privacy and safety', 'About Circlo']);
    expect(SETTINGS_PAGES.map((p) => p.href)).toEqual(['/devices', '/settings/account', '/settings/storage', '/settings/display', '/settings/notifications', '/settings/privacy', '/settings/about']);
    for (const p of SETTINGS_PAGES) expect(p.subtitle).toBeTruthy();
  });

  it('opens the page a link is for', async () => {
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole('link', { name: /Privacy and safety/ }));
    expect(router.push).toHaveBeenCalledWith('/settings/privacy');
    await fireEvent.press(screen.getByRole('link', { name: /Devices/ }));
    expect(router.push).toHaveBeenCalledWith('/devices');
  });

  it('lists Growth last, and only for Circlo’s admins', async () => {
    expect(settingsPages(false)).toEqual(SETTINGS_PAGES);
    expect(settingsPages(true).map((p) => p.href)).toEqual([...SETTINGS_PAGES.map((p) => p.href), '/settings/growth']);
    mockMe = { admin: false };
    await render(<SettingsScreen />);
    expect(screen.queryAllByRole('link')).toHaveLength(SETTINGS_PAGES.length);
  });

  it('opens Growth for an admin', async () => {
    mockMe = { admin: true };
    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole('link', { name: /^Growth\./ }));
    expect(router.push).toHaveBeenCalledWith('/settings/growth');
  });
});
