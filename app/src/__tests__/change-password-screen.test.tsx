import { fireEvent, render, screen } from '@testing-library/react-native';

import ChangePasswordScreen from '@/app/change-password';

jest.mock('expo-router', () => ({ router: { back: jest.fn() }, useFocusEffect: () => {} }));
jest.mock('@/lib/account', () => ({ changePassword: jest.fn(() => Promise.resolve()), describeError: String }));
jest.mock('@/lib/dialog', () => ({ showAlert: jest.fn() }));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedIn', account: { userId: 'me', handle: 'sofia_m' } }) }));

const fill = async (current: string, next: string, confirm = next) => {
  await fireEvent.changeText(screen.getByLabelText('Current password'), current);
  await fireEvent.changeText(screen.getByLabelText('New password'), next);
  await fireEvent.changeText(screen.getByLabelText('Confirm new password'), confirm);
  await fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
};

describe('change password screen', () => {
  it('refuses weak, leaked or mismatched new passwords without contacting the server', async () => {
    const { changePassword } = jest.requireMock('@/lib/account');
    await render(<ChangePasswordScreen />);
    await fill('old password here', 'password1234');
    expect(screen.getByRole('alert')).toBeTruthy();
    await fill('old password here', 'copper lantern violet harbour', 'copper lantern violet');
    expect(screen.getByText('The new passwords don’t match.')).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('changes it, then says the other devices were signed out', async () => {
    const { changePassword } = jest.requireMock('@/lib/account');
    const { showAlert } = jest.requireMock('@/lib/dialog');
    const { router } = jest.requireMock('expo-router');
    await render(<ChangePasswordScreen />);
    await fill('old password here', 'copper lantern violet harbour');
    expect(changePassword).toHaveBeenCalledWith(expect.objectContaining({ userId: 'me' }), 'old password here', 'copper lantern violet harbour');
    expect(showAlert).toHaveBeenCalledWith('Password changed', expect.stringMatching(/signed out/));
    expect(router.back).toHaveBeenCalled();
  });
});
