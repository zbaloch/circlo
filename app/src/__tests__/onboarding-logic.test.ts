import { bytesToUuid, equalBytes, fromAnyB64, fromB64, hexGroups, toB64, toB64Url, uuidFromRandom, uuidToBytes } from '@/lib/bytes';

describe('bytes', () => {
  it('base64 round trips arbitrary bytes', () => {
    const data = new Uint8Array(70_000).map((_, i) => i % 256);
    expect(new Uint8Array(fromB64(toB64(data)))).toEqual(data);
    expect(toB64(new Uint8Array([104, 105]))).toBe('aGk=');
  });

  it('uuid strings map to the same 16 bytes the server uses', () => {
    const id = '0193a1b2-c3d4-7e5f-8a6b-9c0d1e2f3a4b';
    const b = new Uint8Array(uuidToBytes(id));
    expect(b.length).toBe(16);
    expect(b[0]).toBe(0x01);
    expect(b[15]).toBe(0x4b);
    expect(bytesToUuid(b.buffer)).toBe(id);
    expect(() => uuidToBytes('not-a-uuid')).toThrow();
  });

  it('builds valid v4 uuids from random bytes', () => {
    const id = uuidFromRandom(new Uint8Array(16).fill(0xff).buffer);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('compares and formats bytes', () => {
    expect(equalBytes(new Uint8Array([1, 2]).buffer, new Uint8Array([1, 2]).buffer)).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2]).buffer, new Uint8Array([1, 3]).buffer)).toBe(false);
    expect(hexGroups(new Uint8Array([0xab, 0xcd, 0x01, 0x02, 0x03]).buffer)).toBe('abcd 0102 03');
  });
});

describe('base64url for passkeys', () => {
  it('encodes without padding and decodes either alphabet', () => {
    const data = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x01]);
    expect(toB64Url(data)).toBe('-_-_AAE');
    expect(new Uint8Array(fromAnyB64('-_-_AAE'))).toEqual(data);
    expect(new Uint8Array(fromAnyB64('+/+/AAE='))).toEqual(data);
    expect(new Uint8Array(fromAnyB64(toB64(data)))).toEqual(data);
  });
});
