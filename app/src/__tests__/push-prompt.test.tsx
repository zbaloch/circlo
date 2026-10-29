import { fireEvent, render, screen } from '@testing-library/react-native';

import EnableNotificationsScreen from '@/app/enable-notifications';
import { pushPermissionFrom, shouldOfferPush } from '@/lib/push';

jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true })),
  getDevicePushTokenAsync: jest.fn(() => Promise.reject(new Error('no push configuration'))),
}));
jest.mock('@/api/client', () => ({ api: {} }));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedIn', account: { deviceId: 'd1' } }) }));

describe('notification permission', () => {
  it('knows when the system popup can still be shown', () => {
    expect(pushPermissionFrom({ granted: true, canAskAgain: true })).toBe('on');
    expect(pushPermissionFrom({ granted: false, canAskAgain: true })).toBe('ask');
    expect(pushPermissionFrom({ granted: false, canAskAgain: false })).toBe('blocked');
  });

  it('offers Circlo’s screen only while the popup is unused and the user hasn’t said “Not now”', () => {
    expect(shouldOfferPush('ask', false)).toBe(true);
    expect(shouldOfferPush('ask', true)).toBe(false);
    expect(shouldOfferPush('on', false)).toBe(false);
    expect(shouldOfferPush('blocked', false)).toBe(false);
  });
});

describe('enable notifications screen', () => {
  const Notifications = jest.requireMock('expo-notifications');
  const SecureStore = jest.requireMock('expo-secure-store');
  const { router } = jest.requireMock('expo-router');
  beforeEach(() => jest.clearAllMocks());

  it('“Not now” never shows the system popup, so it can still be asked later', async () => {
    await render(<EnableNotificationsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('circlo.push-prompt-dismissed', '1');
    expect(router.back).toHaveBeenCalled();
  });

  it('shows the system popup only after “Turn on notifications”', async () => {
    await render(<EnableNotificationsScreen />);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalled();
  });
});
