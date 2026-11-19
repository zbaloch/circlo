import { act, fireEvent, render, screen } from '@testing-library/react-native';

import DisplaySettings from '@/app/settings/display';
import { SETTINGS_PAGES } from '@/app/settings/index';
import { loadTheme, parseDarkTheme, parseTheme, resolveScheme, setDarkTheme, setTheme } from '@/lib/theme';
import { setItem } from '@/lib/storage';
import { applyDarkTheme, applyScheme } from '@/theme/color-scheme';
import { darkNeutrals, neutralVars } from '@/theme/tokens';

jest.mock('@/theme/color-scheme', () => ({ applyScheme: jest.fn(), applyDarkTheme: jest.fn() }));
const mockStored: Record<string, string | null> = {};
jest.mock('@/lib/storage', () => ({
  getItem: jest.fn(async (k: string) => mockStored[k] ?? null),
  setItem: jest.fn(async () => undefined),
}));

/**
 * Display (owner 2026-11-19): the colour mode, System (the default), Light or Dark, and whenever the app can be dark,
 * which dark theme, Dim (classic Twitter's navy) or Dark (the default). Kept on this device.
 */
describe('display theme', () => {
  beforeEach(async () => {
    jest.mocked(applyScheme).mockClear();
    jest.mocked(applyDarkTheme).mockClear();
    jest.mocked(setItem).mockClear();
    await act(() => setTheme('system'));
    await act(() => setDarkTheme('dark'));
  });

  it('follows the device unless Light or Dark was chosen, and is Dark unless Dim was', async () => {
    expect(parseTheme(null)).toBe('system');
    expect(parseTheme('something else')).toBe('system');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseDarkTheme(null)).toBe('dark');
    expect(parseDarkTheme('dim')).toBe('dim');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');

    mockStored['circlo.theme'] = 'dark';
    mockStored['circlo.dark-theme'] = 'dim';
    await loadTheme();
    expect(applyScheme).toHaveBeenLastCalledWith('dark');
    expect(applyDarkTheme).toHaveBeenLastCalledWith('dim');
    mockStored['circlo.theme'] = null;
    mockStored['circlo.dark-theme'] = null;
    await loadTheme();
    expect(applyScheme).toHaveBeenLastCalledWith('system');
    expect(applyDarkTheme).toHaveBeenLastCalledWith('dark');
  });

  it('gives Dim the classic Twitter navy, and both dark themes the same variables', () => {
    expect(darkNeutrals.dim.surface).toBe('#15202B');
    expect(darkNeutrals.dim.border).toBe('#38444D');
    expect(Object.keys(neutralVars('dim'))).toEqual(Object.keys(neutralVars('dark')));
    expect(neutralVars('dim')['--circlo-surface-dark']).toBe('#15202B');
  });

  it('is a settings page; the colour mode and dark theme apply at once and stay on this device', async () => {
    expect(SETTINGS_PAGES.map((p) => p.title)).toContain('Display');
    await render(<DisplaySettings />);
    expect(screen.getByLabelText('System').props.accessibilityState).toMatchObject({ checked: true });
    // System can be dark, so the dark theme is offered.
    expect(screen.getByText('Dark theme')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Dim'));
    expect(applyDarkTheme).toHaveBeenLastCalledWith('dim');
    expect(setItem).toHaveBeenLastCalledWith('circlo.dark-theme', 'dim');
    expect(screen.getByLabelText('Dim').props.accessibilityState).toMatchObject({ checked: true });

    // Light: no dark theme to choose.
    await fireEvent.press(screen.getByLabelText('Light'));
    expect(applyScheme).toHaveBeenLastCalledWith('light');
    expect(setItem).toHaveBeenLastCalledWith('circlo.theme', 'light');
    expect(screen.queryByText('Dark theme')).toBeNull();

    // Dark: offered again, still on Dim.
    await fireEvent.press(screen.getAllByLabelText('Dark')[0]);
    expect(applyScheme).toHaveBeenLastCalledWith('dark');
    expect(screen.getByText('Dark theme')).toBeTruthy();
    expect(screen.getByLabelText('Dim').props.accessibilityState).toMatchObject({ checked: true });
  });
});
