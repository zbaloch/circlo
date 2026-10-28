// The native core isn't available under jest; only pure helpers are tested here.
jest.mock('@circlo/core', () => ({}));

// eslint-disable-next-line import/first
import { compareIdentity } from '@/lib/addressbook';
// eslint-disable-next-line import/first
import { b64url, fromB64url, parseInviteLink } from '@/lib/friends';

const token = new Uint8Array(32).map((_, i) => i * 7);
const fp = new Uint8Array(16).map((_, i) => 255 - i);

describe('invite links', () => {
  const link = `https://circlo.com/i/${b64url(token.buffer)}#${b64url(fp.buffer)}`;

  it('round trips token and fingerprint', () => {
    const parsed = parseInviteLink(link)!;
    expect(new Uint8Array(parsed.token)).toEqual(token);
    expect(new Uint8Array(parsed.fingerprint)).toEqual(fp);
    expect(parseInviteLink(`  ${link}\n`)).not.toBeNull();
    expect(parseInviteLink(link.replace('https://circlo.com', 'circlo:/'))).not.toBeNull();
  });

  it('rejects other hosts, missing fingerprints and wrong lengths', () => {
    expect(parseInviteLink(link.replace('circlo.com', 'evil.example'))).toBeNull();
    expect(parseInviteLink(link.split('#')[0])).toBeNull();
    expect(parseInviteLink(link.replace(/#.*/, '#short'))).toBeNull();
    expect(parseInviteLink('https://circlo.com/i/abc#def')).toBeNull();
    expect(parseInviteLink('not a link')).toBeNull();
  });

  it('base64url has no padding or unsafe characters', () => {
    const s = b64url(new Uint8Array([251, 255, 254]).buffer);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(new Uint8Array(fromB64url(s))).toEqual(new Uint8Array([251, 255, 254]));
  });
});

describe('identity pinning', () => {
  const pinned = { ed25519: 'AAA', x25519: 'BBB' };

  it('detects new, unchanged and changed identities', () => {
    expect(compareIdentity(undefined, pinned)).toBe('new');
    expect(compareIdentity(pinned, { ed25519: 'AAA', x25519: 'BBB' })).toBe('same');
    expect(compareIdentity(pinned, { ed25519: 'AAA', x25519: 'CCC' })).toBe('changed');
    expect(compareIdentity(pinned, { ed25519: 'ZZZ', x25519: 'BBB' })).toBe('changed');
  });
});

describe('accepting a request', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { acceptRequest } = require('@/lib/friends') as typeof import('@/lib/friends');
  const account = { userId: 'me' } as Parameters<typeof acceptRequest>[0];

  it('only places friends in circles 2–100 (circle 1 is "Me only")', async () => {
    for (const bad of [0, 1, 101, 2.5]) {
      await expect(acceptRequest(account, 'them', bad)).rejects.toThrow('invalid circle');
    }
  });

  it('defaults new friends to the Friends circle', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require('@/lib/addressbook').NEW_FRIEND_CIRCLE).toBe(80);
  });
});
