import { render, screen } from '@testing-library/react-native';

import NotificationSettings from '@/app/settings/notifications';

jest.mock('expo-router', () => ({ useFocusEffect: () => {} }));
jest.mock('@/lib/background-check', () => ({
  usesPush: true,
  backgroundChecksOn: async () => true,
  notificationPermission: async () => 'granted',
  enableBackgroundChecks: jest.fn(),
  disableBackgroundChecks: jest.fn(),
}));
const mockMe = { emailNotifications: true };
jest.mock('@/lib/me', () => ({ useMe: () => mockMe, refreshMe: jest.fn(async () => mockMe), setEmailNotifications: jest.fn() }));
jest.mock('@/api/client', () => ({}));

describe('Notifications settings', () => {
  it('treats the phone notification and the daily email as two separate channels', async () => {
    await render(<NotificationSettings />);
    expect(screen.getByText('A daily email')).toBeTruthy();
    expect(screen.getByText(/separate from notifications on your phone/)).toBeTruthy();
    // Nothing says one replaces the other any more.
    expect(screen.queryByText(/instead/)).toBeNull();
    expect(screen.queryByText(/not even an email/)).toBeNull();
  });
});
