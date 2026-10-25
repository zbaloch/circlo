import { bytesToUuid, equalBytes, fromB64, hexGroups, toB64, uuidFromRandom, uuidToBytes } from '@/lib/bytes';

// The native core isn't available under jest; only the pure helpers are tested here (flows run on the device).
jest.mock('@halqo/core', () => ({
  newSymmetricKey: () => new Uint8Array(32).map((_, i) => (i * 37 + 11) % 256).buffer,
  normalizeHandle: (h: string) => h.trim().toLowerCase(),
}));

// eslint-disable-next-line import/first
import { pickConfirmPositions, wordsMatch } from '@/lib/account';

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

describe('recovery phrase confirmation', () => {
  const words = Array.from({ length: 24 }, (_, i) => `word${i + 1}`);

  it('picks three distinct, sorted positions within the phrase', () => {
    const p = pickConfirmPositions();
    expect(p).toHaveLength(3);
    expect(new Set(p).size).toBe(3);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
    expect(p.every((x) => x >= 0 && x < 24)).toBe(true);
  });

  it('accepts the right words regardless of case and spaces, rejects anything else', () => {
    expect(wordsMatch(words, [0, 5, 23], ['word1', ' WORD6 ', 'word24'])).toBe(true);
    expect(wordsMatch(words, [0, 5, 23], ['word1', 'word6', 'word23'])).toBe(false);
    expect(wordsMatch(words, [0, 5, 23], ['word1', 'word6'])).toBe(false);
  });
});
