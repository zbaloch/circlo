import { login, resendLoginCode } from '@/lib/account';

const mockPost = jest.fn();
jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, api: { POST: (...a: unknown[]) => mockPost(...a) } };
});
jest.mock('@/lib/keystore', () => ({ saveAccount: jest.fn(), updateRefreshToken: jest.fn() }));
jest.mock('@/lib/me', () => ({ setMe: jest.fn() }));

describe('the login request', () => {
  beforeEach(() => mockPost.mockReset());

  it('asks for the emailed-code step, and returns where the code went', async () => {
    mockPost.mockResolvedValue({ data: { status: 'code_sent', email: 'a•••@example.com', challenge: 'ch1' }, response: { ok: true, status: 202 } });
    await expect(login(' ana ', 'a long password here')).resolves.toEqual({ step: 'code', email: 'a•••@example.com', challenge: 'ch1' });
    expect(mockPost).toHaveBeenCalledWith('/v1/auth/login', { body: { login: 'ana', password: 'a long password here', emailCode: true } });
  });

  it('asks for a new code for the same attempt', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok' }, response: { ok: true, status: 202 } });
    await resendLoginCode('ana', 'ch1');
    expect(mockPost).toHaveBeenCalledWith('/v1/auth/login/resend', { body: { login: 'ana', challenge: 'ch1' } });
  });
});
