import { fireEvent, render, screen } from '@testing-library/react-native';

import SignupScreen from '@/app/(auth)/signup';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
// Signup runs OPAQUE in the native core; these tests cover only the terms agreement.
jest.mock('@/lib/account', () => ({ MIN_PASSWORD: 8, normalizeHandle: (h: string) => h, describeError: String, Signup: { start: jest.fn() } }));
jest.mock('@/lib/signup-store', () => ({ setPendingSignup: jest.fn() }));

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
});
