import { createRecoveryPasskey, isCancelled, PasskeyUnavailableError, passkeyPrf, RP_ID } from '@/lib/passkey';
import { toB64 } from '@/lib/bytes';

jest.mock('react-native-passkey', () => ({ Passkey: { isSupported: jest.fn(() => true), create: jest.fn(), get: jest.fn() } }));
const mockPasskey = jest.requireMock('react-native-passkey').Passkey;
jest.mock('@circlo/core', () => ({
  newSymmetricKey: () => new Uint8Array(32).fill(7).buffer,
  passkeyPrfSalt: () => new Uint8Array(32).fill(9).buffer,
}));

const prf = (byte: number) => toB64(new Uint8Array(32).fill(byte));
const withPrf = (first?: string, enabled = true) => ({ clientExtensionResults: { prf: { enabled, results: first ? { first } : {} } } });

beforeEach(() => jest.clearAllMocks());

describe('passkey recovery', () => {
  it('asks for the PRF of the Circlo passkey for www.hellocirclo.com, with Face ID required', async () => {
    mockPasskey.get.mockResolvedValueOnce(withPrf(prf(1)));
    const out = await passkeyPrf();
    expect(new Uint8Array(out)).toEqual(new Uint8Array(32).fill(1));
    const request = mockPasskey.get.mock.calls[0][0];
    expect(request).toMatchObject({ rpId: RP_ID, userVerification: 'required' });
    expect(request.extensions.prf.eval.first).toEqual(new Uint8Array(32).fill(9));
  });

  it('creates a discoverable passkey and checks it right away; the result is what get returns', async () => {
    mockPasskey.create.mockResolvedValueOnce(withPrf(prf(2)));
    mockPasskey.get.mockResolvedValueOnce(withPrf(prf(2)));
    const out = await createRecoveryPasskey('sofia');
    expect(new Uint8Array(out)).toEqual(new Uint8Array(32).fill(2));
    const request = mockPasskey.create.mock.calls[0][0];
    expect(request).toMatchObject({ rp: { id: RP_ID, name: 'Circlo' }, user: { name: 'sofia' }, authenticatorSelection: { residentKey: 'required' } });
    expect(request.extensions.prf.eval.first).toEqual(new Uint8Array(32).fill(9));
  });

  it('works when the provider only gives PRF on get', async () => {
    mockPasskey.create.mockResolvedValueOnce(withPrf(undefined));
    mockPasskey.get.mockResolvedValueOnce(withPrf(prf(3)));
    expect(new Uint8Array(await createRecoveryPasskey('sofia'))).toEqual(new Uint8Array(32).fill(3));
  });

  it('refuses providers without PRF, and outputs that change between create and get', async () => {
    mockPasskey.create.mockResolvedValueOnce(withPrf(undefined, false));
    await expect(createRecoveryPasskey('sofia')).rejects.toBeInstanceOf(PasskeyUnavailableError);

    mockPasskey.create.mockResolvedValueOnce(withPrf(prf(4)));
    mockPasskey.get.mockResolvedValueOnce(withPrf(prf(5)));
    await expect(createRecoveryPasskey('sofia')).rejects.toBeInstanceOf(PasskeyUnavailableError);

    mockPasskey.get.mockResolvedValueOnce(withPrf(undefined));
    await expect(passkeyPrf()).rejects.toBeInstanceOf(PasskeyUnavailableError);
  });

  it('tells a closed system sheet apart from real errors', () => {
    expect(isCancelled({ error: 'UserCancelled' })).toBe(true);
    expect(isCancelled(new Error('The operation was cancelled'))).toBe(true);
    expect(isCancelled(new Error('No credentials'))).toBe(false);
  });
});
