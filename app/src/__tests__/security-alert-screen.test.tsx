import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SecurityAlertScreen from '@/app/security-alert';

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: () => mockBack(), replace: (p: string) => mockReplace(p) },
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
const mockSeen = jest.fn(async () => {});
jest.mock('@/lib/security-events', () => ({
  newSignIns: async () => [{ id: 's1', createdAt: '2026-11-06T10:00:00Z' }],
  markSignInsSeen: () => mockSeen(),
}));
const mockSession = { status: 'signedIn', account: { userId: 'me', handle: 'me' } };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));

describe('new sign-in screen', () => {
  it('leads with "Yes, it was me", since it usually was', async () => {
    await render(<SecurityAlertScreen />);
    // The main (filled) button comes first; changing the password is right below it.
    const order = screen.getAllByText(/^(Yes, it was me|No, change my password)$/).map((t) => t.props.children);
    expect(order).toEqual(['Yes, it was me', 'No, change my password']);

    await fireEvent.press(screen.getByText('Yes, it was me'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockSeen).toHaveBeenCalled();
  });

  it('still offers changing the password as a full button', async () => {
    await render(<SecurityAlertScreen />);
    await fireEvent.press(screen.getByText('No, change my password'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/change-password'));
  });
});
