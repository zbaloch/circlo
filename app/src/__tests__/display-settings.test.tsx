import { act, fireEvent, render, screen } from '@testing-library/react-native';

import DisplaySettings from '@/app/settings/display';
import { SETTINGS_PAGES } from '@/app/settings/index';
import { loadTheme, parseTheme, resolveScheme, setTheme } from '@/lib/theme';
import { setItem } from '@/lib/storage';
import { applyScheme } from '@/theme/color-scheme';

jest.mock('@/theme/color-scheme', () => ({ applyScheme: jest.fn() }));
let mockStored: string | null = null;
jest.mock('@/lib/storage', () => ({ getItem: jest.fn(async () => mockStored), setItem: jest.fn(async () => undefined) }));

/** Display (owner 2026-11-19): Light, Dark, or follow the device, which is the default. Kept on this device. */
describe('display theme', () => {
  beforeEach(() => {
    jest.mocked(applyScheme).mockClear();
    jest.mocked(setItem).mockClear();
  });

  it('follows the device unless Light or Dark was chosen', async () => {
    expect(parseTheme(null)).toBe('system');
    expect(parseTheme('something else')).toBe('system');
    expect(parseTheme('dark')).toBe('dark');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');

    mockStored = 'dark';
    await loadTheme();
    expect(applyScheme).toHaveBeenLastCalledWith('dark');
    mockStored = null;
    await loadTheme();
    expect(applyScheme).toHaveBeenLastCalledWith('system');
  });

  it('is a settings page, and picking a theme applies it and keeps it on this device', async () => {
    expect(SETTINGS_PAGES.map((p) => p.title)).toContain('Display');
    await act(() => setTheme('system'));
    await render(<DisplaySettings />);
    expect(screen.getByLabelText('Follow your device').props.accessibilityState).toMatchObject({ checked: true });

    await fireEvent.press(screen.getByLabelText('Dark'));
    expect(applyScheme).toHaveBeenLastCalledWith('dark');
    expect(setItem).toHaveBeenLastCalledWith('circlo.theme', 'dark');
    expect(screen.getByLabelText('Dark').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Follow your device').props.accessibilityState).toMatchObject({ checked: false });
  });
});
