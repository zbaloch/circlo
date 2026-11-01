import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignupScreen from '@/app/(auth)/signup';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
// These tests cover only the terms agreement; signing up itself is a server call.
jest.mock('@/lib/account', () => ({ normalizeUsername: (h: string) => h, looksLikeEmail: () => true, describeError: String, startSignup: jest.fn(async () => 'sam@example.com') }));

describe('signup terms', () => {
  it('can’t continue until the terms are agreed to, and links to the terms and privacy policy', async () => {
    const Linking = jest.requireMock('expo-linking');
    await render(<SignupScreen />);
    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(cont).toBeDisabled();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'I agree to the Terms of Use and Privacy Policy' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();

    await fireEvent.press(screen.getByText('Terms of Use'));
    await fireEvent.press(screen.getByText('Privacy Policy'));
    expect(Linking.openURL.mock.calls.map((c: string[]) => c[0])).toEqual(['https://www.hellocirclo.com/terms', 'https://www.hellocirclo.com/privacy']);
  });

  it('asks only for a username, email and password (the name comes later, in Edit profile)', async () => {
    const { startSignup } = jest.requireMock('@/lib/account');
    await render(<SignupScreen />);
    expect(screen.queryByText('Name')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Username'), 'sam_k');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'sam@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'violet tractor sings at dawn 47');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'I agree to the Terms of Use and Privacy Policy' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(startSignup).toHaveBeenCalledWith({ username: 'sam_k', email: 'sam@example.com', password: 'violet tractor sings at dawn 47' }));
  });
});
