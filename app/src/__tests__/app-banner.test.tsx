import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { AppBanner } from '@/components/app-banner';
import { appBannerTarget } from '@/lib/app-banner';
import { APP_BANNER_ENABLED } from '@/lib/features';
import { APP_STORE_URL, openLink } from '@/lib/links';

jest.mock('@/lib/links', () => ({ ...jest.requireActual('@/lib/links'), openLink: jest.fn() }));

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('app banner: who sees it', () => {
  const web = { enabled: true, os: 'web', maxTouchPoints: 0 };

  it('shows in a browser on an iPhone, and on an iPad that calls itself a Mac', () => {
    expect(appBannerTarget({ ...web, userAgent: IPHONE, maxTouchPoints: 5 })).toBe('ios');
    expect(appBannerTarget({ ...web, userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe('ios');
  });

  it('stays hidden on a real Mac, on Android, on Windows, and in the phone apps', () => {
    expect(appBannerTarget({ ...web, userAgent: IPAD_AS_MAC })).toBeNull();
    expect(appBannerTarget({ ...web, userAgent: ANDROID, maxTouchPoints: 5 })).toBeNull();
    expect(appBannerTarget({ ...web, userAgent: WINDOWS })).toBeNull();
    expect(appBannerTarget({ ...web, os: 'ios', userAgent: IPHONE })).toBeNull();
  });

  it('stays hidden while switched off', () => {
    expect(appBannerTarget({ ...web, enabled: false, userAgent: IPHONE })).toBeNull();
  });

  it('is off until App Store review approves 1.1 (1.0 has no chat)', () => {
    expect(APP_BANNER_ENABLED).toBe(false);
  });

  it('links to the App Store listing without a country, so each visitor gets their own store', () => {
    expect(APP_STORE_URL).toBe('https://apps.apple.com/app/circlo-family-friends/id6828949778');
  });
});

describe('app banner on screen', () => {
  const realOS = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: IPHONE, maxTouchPoints: 5 }, configurable: true });
    globalThis.localStorage?.clear();
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: realOS, configurable: true });
  });

  it('opens the App Store from Get, and stays closed once closed', async () => {
    await render(<AppBanner enabled />);
    expect(await screen.findByText('Get Circlo for iPhone')).toBeTruthy();
    await fireEvent.press(screen.getByText('Get'));
    expect(openLink).toHaveBeenCalledWith(APP_STORE_URL);

    await fireEvent.press(screen.getByLabelText('Close'));
    expect(screen.queryByText('Get Circlo for iPhone')).toBeNull();
  });
});
