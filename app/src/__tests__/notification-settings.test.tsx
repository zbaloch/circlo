import { fireEvent, render, screen } from '@testing-library/react-native';

import NotificationSettings from '@/app/settings/notifications';
import { setNotificationSettings } from '@/lib/me';

jest.mock('expo-router', () => ({ useFocusEffect: (f: () => void) => jest.requireActual('react').useEffect(f, []) }));
let mockPhoneOn = true;
jest.mock('@/lib/background-check', () => ({
  usesPush: true,
  backgroundChecksOn: async () => mockPhoneOn,
  notificationPermission: async () => 'granted',
  enableBackgroundChecks: jest.fn(),
  disableBackgroundChecks: jest.fn(),
}));
const mockMe = { emailNotifications: true, pushMessages: true, pushReplies: false, pushFriends: true, pushDaily: true };
jest.mock('@/lib/me', () => ({ useMe: () => mockMe, refreshMe: jest.fn(async () => mockMe), setNotificationSettings: jest.fn(async () => mockMe) }));
jest.mock('@/api/client', () => ({}));

describe('Notifications settings', () => {
  beforeEach(() => {
    mockPhoneOn = true;
    jest.mocked(setNotificationSettings).mockClear();
  });

  it('treats the phone notification and the daily email as two separate channels', async () => {
    await render(<NotificationSettings />);
    expect(screen.getByText('Daily email')).toBeTruthy();
    expect(screen.getByText(/separate from notifications on your phone/)).toBeTruthy();
    // Nothing says one replaces the other any more.
    expect(screen.queryByText(/instead/)).toBeNull();
    expect(screen.queryByText(/not even an email/)).toBeNull();
  });

  it('lets each kind be turned on or off, X-style, once this phone has push on', async () => {
    await render(<NotificationSettings />);
    expect(await screen.findByText('As it happens')).toBeTruthy();
    expect(screen.getByLabelText('Messages').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText('Replies').props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText('Friend requests and new friends')).toBeTruthy();
    expect(screen.getByText('Daily reminder')).toBeTruthy();
    expect(screen.getByText('Security alerts')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Replies'));
    expect(setNotificationSettings).toHaveBeenCalledWith({ pushReplies: true });
    await fireEvent.press(screen.getByLabelText('Daily reminder'));
    expect(setNotificationSettings).toHaveBeenCalledWith({ pushDaily: false });
  });

  it('hides the kinds while this phone has push off', async () => {
    mockPhoneOn = false;
    await render(<NotificationSettings />);
    expect(await screen.findByText('Push notifications')).toBeTruthy();
    expect(screen.queryByText('As it happens')).toBeNull();
    expect(screen.queryByText('Daily reminder')).toBeNull();
    expect(screen.getByText('Daily email')).toBeTruthy();
  });
});
