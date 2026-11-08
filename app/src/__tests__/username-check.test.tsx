import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignupScreen from '@/app/(auth)/signup';
import { checkUsername } from '@/lib/username';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('@/lib/account', () => ({
  ...jest.requireActual('@/lib/account'),
  startSignup: jest.fn(async () => 'sam@example.com'),
}));

describe('checkUsername: the rules, explained as you type', () => {
  it('a good username, shown as people will see it', () => {
    expect(checkUsername('za_soomro')).toEqual({ handle: 'za_soomro', ok: true });
    expect(checkUsername('@sam_k')).toEqual({ handle: 'sam_k', ok: true });
  });

  it('capitals are simply made small: no message', () => {
    expect(checkUsername('ZA_Soomro')).toEqual({ handle: 'za_soomro', ok: true });
  });

  it('names the character that isn’t allowed, and offers a fix', () => {
    expect(checkUsername('Z.A_Soomro')).toEqual({
      handle: 'z.a_soomro',
      ok: false,
      problem: 'Usernames can’t have "." – only letters, numbers and _.',
      suggestion: 'z_a_soomro',
    });
    expect(checkUsername('zulfiqar.soomro').suggestion).toBe('zulfiqar_soomro');
    expect(checkUsername('sam-k').problem).toBe('Usernames can’t have "-" – only letters, numbers and _.');
  });

  it('spaces get their own words', () => {
    expect(checkUsername('Zulfiqar Soomro')).toMatchObject({ ok: false, problem: 'Usernames can’t have spaces – only letters, numbers and _.', suggestion: 'zulfiqar_soomro' });
    expect(checkUsername('z a.soomro').problem).toBe('Usernames can’t have spaces or "." – only letters, numbers and _.');
    expect(checkUsername('a.b-c.d').problem).toBe('Usernames can’t have "." or "-" – only letters, numbers and _.');
  });

  it('letters outside a–z: accents are dropped in the suggestion, other scripts become _', () => {
    expect(checkUsername('zoë').suggestion).toBe('zoe');
    expect(checkUsername('zoë').problem).toBe('Usernames can’t have "ë" – only letters, numbers and _.');
  });

  it('too short or too long', () => {
    expect(checkUsername('za')).toEqual({ handle: 'za', ok: false, problem: 'At least 3 characters.' });
    expect(checkUsername('a'.repeat(31))).toMatchObject({ ok: false, problem: 'Up to 30 characters.' });
    expect(checkUsername('')).toEqual({ handle: '', ok: false });
  });

  it('no suggestion when the fix wouldn’t be a valid username either', () => {
    expect(checkUsername('a.').suggestion).toBeUndefined();
  });
});

describe('the sign-up screen', () => {
  const field = () => screen.getByLabelText('Username');

  it('makes capitals small as you type, and shows the @username people will see', async () => {
    await render(<SignupScreen />);
    await fireEvent.changeText(field(), 'ZA_Soomro');
    expect(field().props.value).toBe('za_soomro');
    expect(screen.getByText('Your username: @za_soomro')).toBeTruthy();
  });

  it('says straight away what isn’t allowed, and the suggestion fills itself in', async () => {
    await render(<SignupScreen />);
    await fireEvent.changeText(field(), 'Zulfiqar Soomro');
    expect(screen.getByText('Usernames can’t have spaces – only letters, numbers and _.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Use @zulfiqar_soomro' }));
    expect(field().props.value).toBe('zulfiqar_soomro');
    expect(screen.queryByText(/can’t have/)).toBeNull();
    expect(screen.getByText('Your username: @zulfiqar_soomro')).toBeTruthy();
  });

  it('Continue with a username that isn’t allowed explains why, and sends nothing', async () => {
    const { startSignup } = jest.requireMock('@/lib/account');
    await render(<SignupScreen />);
    await fireEvent.changeText(field(), 'z.a');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'sam@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'violet tractor sings at dawn 47');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'I’m 16 or older and agree to the Terms of Use and Privacy Policy' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getAllByText('Usernames can’t have "." – only letters, numbers and _.').length).toBeGreaterThan(0);
    expect(startSignup).not.toHaveBeenCalled();
  });

  it('a good username signs up as shown', async () => {
    const { startSignup } = jest.requireMock('@/lib/account');
    await render(<SignupScreen />);
    await fireEvent.changeText(field(), 'Sam_K');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'sam@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'violet tractor sings at dawn 47');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'I’m 16 or older and agree to the Terms of Use and Privacy Policy' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(startSignup).toHaveBeenCalledWith({ username: 'sam_k', email: 'sam@example.com', password: 'violet tractor sings at dawn 47' }));
  });
});
