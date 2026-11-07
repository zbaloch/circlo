import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import LoginScreen from '@/app/(auth)/login';
import LoginCodeScreen from '@/app/(auth)/login-code';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
const mockSignIn = jest.fn();
jest.mock('@/lib/session', () => ({ useSession: () => ({ signIn: mockSignIn }) }));
jest.mock('@/components/auth-screen', () => ({ AuthScreen: ({ children }: { children: React.ReactNode }) => children }));
const mockLogin = jest.fn();
const mockVerify = jest.fn();
const mockResend = jest.fn(async () => {});
jest.mock('@/lib/account', () => ({
  ...jest.requireActual('@/lib/account'),
  login: (...a: unknown[]) => mockLogin(...a),
  verifyLoginCode: (...a: unknown[]) => mockVerify(...a),
  resendLoginCode: (...a: unknown[]) => mockResend(...(a as [])),
}));
jest.mock('@/api/client', () => ({ ApiError: class extends Error {} }));

const account = { userId: 'u1', handle: 'ana' };

describe('logging in with a code by email', () => {
  beforeEach(() => jest.clearAllMocks());

  it('after the right password, goes on to "Check your email"', async () => {
    mockLogin.mockResolvedValue({ step: 'code', email: 'a•••@example.com', challenge: 'ch1' });
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Username or email'), 'ana');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'a long password here');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Log in' }).at(-1)!);
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({ pathname: '/login-code', params: { login: 'ana', email: 'a•••@example.com', challenge: 'ch1' } }),
    );
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('the code signs in; a new code can be sent', async () => {
    mockParams = { login: 'ana', email: 'a•••@example.com', challenge: 'ch1' };
    mockVerify.mockResolvedValue(account);
    await render(<LoginCodeScreen />);
    expect(screen.getByText(/a•••@example\.com/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Send a new code' }));
    expect(mockResend).toHaveBeenCalledWith('ana', 'ch1');

    await fireEvent.changeText(screen.getByLabelText('Code'), '12 34 56');
    await fireEvent.press(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith(account));
    expect(mockVerify).toHaveBeenCalledWith('ana', 'ch1', '123456');
  });
});
