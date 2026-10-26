import { kindName, matchMedia, type PickedMedia } from '@/lib/media';
import { defaultCircle, validateDraft } from '@/lib/posts';
import { relativeTime } from '@/lib/time';

// Native modules don't load under jest; these tests cover the pure logic only.
jest.mock('@halqo/core', () => ({}));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-video-thumbnails', () => ({}));

const img: PickedMedia = { uri: 'file:///a.jpg', type: 'image', width: 10, height: 10 };
const vid: PickedMedia = { uri: 'file:///a.mp4', type: 'video', width: 10, height: 10 };

describe('validateDraft', () => {
  it('needs text or media, at most 500 characters', () => {
    expect(validateDraft({ text: '', circle: 7, media: [] })).toMatch(/Write something/);
    expect(validateDraft({ text: 'hi', circle: 7, media: [] })).toBeNull();
    expect(validateDraft({ text: '', circle: 7, media: [img] })).toBeNull();
    expect(validateDraft({ text: 'x'.repeat(500), circle: 7, media: [] })).toBeNull();
    expect(validateDraft({ text: 'x'.repeat(501), circle: 7, media: [] })).toMatch(/500/);
    // Counted in characters, not UTF-16 units: 500 emoji are fine.
    expect(validateDraft({ text: '😀'.repeat(500), circle: 7, media: [] })).toBeNull();
  });

  it('allows up to 4 photos or exactly 1 video', () => {
    expect(validateDraft({ text: '', circle: 7, media: [img, img, img, img] })).toBeNull();
    expect(validateDraft({ text: '', circle: 7, media: [img, img, img, img, img] })).not.toBeNull();
    expect(validateDraft({ text: '', circle: 7, media: [vid] })).toBeNull();
    expect(validateDraft({ text: '', circle: 7, media: [vid, vid] })).not.toBeNull();
    expect(validateDraft({ text: '', circle: 7, media: [vid, img] })).not.toBeNull();
  });

  it('requires a circle from 1 to 100', () => {
    expect(validateDraft({ text: 'a', circle: 0, media: [] })).not.toBeNull();
    expect(validateDraft({ text: 'a', circle: 101, media: [] })).not.toBeNull();
    expect(validateDraft({ text: 'a', circle: 1, media: [] })).toBeNull();
    expect(validateDraft({ text: 'a', circle: 100, media: [] })).toBeNull();
  });
});

describe('defaultCircle', () => {
  it('remembers the last circle, and starts at "Me only" so nothing is shared by accident', () => {
    expect(defaultCircle({})).toBe(1);
    expect(defaultCircle({ lastCircle: 7 })).toBe(7);
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
