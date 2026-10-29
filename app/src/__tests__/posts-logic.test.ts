import { kindName, matchMedia, type PickedMedia } from '@/lib/media';
import { STARTER_CIRCLES } from '@/lib/addressbook';
import { defaultAudience, validateDraft, type Draft } from '@/lib/posts';
import { relativeTime } from '@/lib/time';

// Native modules don't load under jest; these tests cover the pure logic only.
jest.mock('@circlo/core', () => ({}));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-video-thumbnails', () => ({}));

const img: PickedMedia = { uri: 'file:///a.jpg', type: 'image', width: 10, height: 10 };
const vid: PickedMedia = { uri: 'file:///a.mp4', type: 'video', width: 10, height: 10 };

const book = { circleDefs: STARTER_CIRCLES };
const check = (d: Omit<Draft, 'audience'> & { audience?: Draft['audience'] }) => validateDraft({ audience: { kind: 'everyone' }, ...d }, book);

describe('validateDraft', () => {
  it('needs text or media, at most 500 characters', () => {
    expect(check({ text: '', media: [] })).toMatch(/Write something/);
    expect(check({ text: 'hi', media: [] })).toBeNull();
    expect(check({ text: '', media: [img] })).toBeNull();
    expect(check({ text: 'x'.repeat(500), media: [] })).toBeNull();
    expect(check({ text: 'x'.repeat(501), media: [] })).toMatch(/500/);
    // Counted in characters, not UTF-16 units: 500 emoji are fine.
    expect(check({ text: '😀'.repeat(500), media: [] })).toBeNull();
  });

  it('allows up to 4 photos or exactly 1 video', () => {
    expect(check({ text: '', media: [img, img, img, img] })).toBeNull();
    expect(check({ text: '', media: [img, img, img, img, img] })).not.toBeNull();
    expect(check({ text: '', media: [vid] })).toBeNull();
    expect(check({ text: '', media: [vid, vid] })).not.toBeNull();
    expect(check({ text: '', media: [vid, img] })).not.toBeNull();
  });

  it('needs an audience: Only me, Everyone, or existing circles', () => {
    expect(check({ text: 'a', media: [], audience: { kind: 'onlyMe' } })).toBeNull();
    expect(check({ text: 'a', media: [], audience: { kind: 'everyone' } })).toBeNull();
    expect(check({ text: 'a', media: [], audience: { kind: 'circles', ids: [1, 3] } })).toBeNull();
    expect(check({ text: 'a', media: [], audience: { kind: 'circles', ids: [] } })).not.toBeNull();
    expect(check({ text: 'a', media: [], audience: { kind: 'circles', ids: [7] } })).not.toBeNull();
  });
});

describe('defaultAudience', () => {
  it('remembers my last choice, and starts at Only me so nothing is shared by accident', () => {
    expect(defaultAudience(book)).toEqual({ kind: 'onlyMe' });
    expect(defaultAudience({ ...book, lastAudience: { kind: 'circles', ids: [2, 3] } })).toEqual({ kind: 'circles', ids: [2, 3] });
    // A remembered circle that was deleted falls back to Only me.
    expect(defaultAudience({ ...book, lastAudience: { kind: 'circles', ids: [7] } })).toEqual({ kind: 'onlyMe' });
  });
});

describe('matchMedia', () => {
  const key = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
  const oid = (k: string) => Uint8Array.from(k.slice(0, 32).match(/../g)!.map((h) => parseInt(h, 16))).buffer;
  const item = (n: number, kind: number) =>
    ({ objectId: oid(key(n)), kind, mime: 'image/jpeg', fileKey: new ArrayBuffer(32), contentLen: 1n, width: 1, height: 1, durationMs: 0n }) as const;

  it('pairs each signed header item with the server object of the same id and kind', () => {
    const header = [item(1, 0), item(2, 1)];
    const got = matchMedia(header, [{ objectKey: key(2), kind: 'thumb' }, { objectKey: key(1), kind: 'full' }], oid);
    expect(got?.map((m) => [m.objectKey, m.kind])).toEqual([
      [key(1), 'full'],
      [key(2), 'thumb'],
    ]);
  });

  it('rejects a server list that disagrees with the signed header', () => {
    const header = [item(1, 0), item(2, 1)];
    expect(matchMedia(header, [{ objectKey: key(1), kind: 'full' }], oid)).toBeNull(); // missing
    expect(matchMedia(header, [{ objectKey: key(1), kind: 'full' }, { objectKey: key(3), kind: 'thumb' }], oid)).toBeNull(); // swapped object
    expect(matchMedia(header, [{ objectKey: key(1), kind: 'thumb' }, { objectKey: key(2), kind: 'thumb' }], oid)).toBeNull(); // wrong kind
  });

  it('names kinds', () => {
    expect([0, 1, 2].map(kindName)).toEqual(['full', 'thumb', 'poster']);
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 9, 26, 12, 0, 0);
  it('formats like Twitter', () => {
    expect(relativeTime(now - 2_000, now)).toBe('now');
    expect(relativeTime(now - 45_000, now)).toBe('45s');
    expect(relativeTime(now - 12 * 60_000, now)).toBe('12m');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h');
    expect(relativeTime(now - 5 * 86_400_000, now)).toBe('5d');
    expect(relativeTime(now - 40 * 86_400_000, now)).toMatch(/^[A-Z][a-z]{2} \d+$/);
    expect(relativeTime(Date.UTC(2024, 0, 3), now)).toMatch(/2024$/);
  });
});
