import { fireEvent, render, screen } from '@testing-library/react-native';

import EnableNotificationsScreen from '@/app/enable-notifications';

jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() } }));
jest.mock('@/lib/background-check', () => ({
  enableBackgroundChecks: jest.fn(() => Promise.resolve('on')),
  dismissNotificationsPrompt: jest.fn(),
}));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedIn', account: { deviceId: 'd1' } }) }));

describe('enable notifications screen', () => {
  const checks = jest.requireMock('@/lib/background-check');
  const { router } = jest.requireMock('expo-router');
  beforeEach(() => jest.clearAllMocks());

  it('says nothing goes through Apple or Google', async () => {
    await render(<EnableNotificationsScreen />);
    expect(screen.getByText(/Nothing goes through Apple or Google/)).toBeTruthy();
  });

  it('“Not now” turns nothing on and never shows the system popup, so it can still be asked later', async () => {
    await render(<EnableNotificationsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(checks.enableBackgroundChecks).not.toHaveBeenCalled();
    expect(checks.dismissNotificationsPrompt).toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
  });

  it('turns background checks on only after “Turn on notifications”', async () => {
    await render(<EnableNotificationsScreen />);
    expect(checks.enableBackgroundChecks).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(checks.enableBackgroundChecks).toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
  });
});
