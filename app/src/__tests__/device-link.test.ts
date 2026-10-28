import { parseLinkQr } from '@/lib/device-link';

// Native modules don't load under jest; this covers the pure QR parsing only.
jest.mock('@circlo/core', () => ({}));
jest.mock('expo-secure-store', () => ({}));

const b64url = (n: number, fill = 7) =>
  btoa(String.fromCharCode(...new Uint8Array(n).fill(fill))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('device link QR', () => {
  it('accepts exactly circlo://link/<32-byte id>#<32-byte key>', () => {
    const parsed = parseLinkQr(`circlo://link/${b64url(32, 1)}#${b64url(32, 2)}`);
    expect(parsed?.linkId.byteLength).toBe(32);
    expect(parsed?.publicKey.byteLength).toBe(32);
    expect(new Uint8Array(parsed!.linkId)[0]).toBe(1);
    expect(new Uint8Array(parsed!.publicKey)[0]).toBe(2);
  });

  it('rejects invites, other schemes and wrong lengths', () => {
    expect(parseLinkQr(`https://circlo.com/i/${b64url(32)}#${b64url(16)}`)).toBeNull();
    expect(parseLinkQr(`circlo://link/${b64url(16)}#${b64url(32)}`)).toBeNull();
    expect(parseLinkQr(`circlo://link/${b64url(32)}`)).toBeNull();
    expect(parseLinkQr('circlo-safety:123')).toBeNull();
  });
});
