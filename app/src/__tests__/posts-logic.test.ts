import type { PickedMedia } from '@/lib/media';
import { STARTER_CIRCLES } from '@/lib/addressbook';
import { fromRow, validateDraft, type Draft } from '@/lib/posts';
import { relativeTime } from '@/lib/time';

// Native modules don't load under jest; these tests cover the pure logic only.
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-video-thumbnails', () => ({}));
jest.mock('@/api/client', () => ({}));

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

describe('posts from the server', () => {
  const row = {
    postId: 'p1',
    authorId: 'me',
    author: { userId: 'me', name: 'Me', username: 'me' },
    text: 'hi',
    createdAt: '2026-11-01T10:00:00Z',
    media: [],
    replyCount: 1,
    likeCount: 2,
    likedByMe: true,
    audience: { kind: 'circles' as const, circles: [2] },
  };

  it('keeps the audience only on my own posts', () => {
    expect(fromRow(row, 'me')).toMatchObject({ mine: true, audience: { kind: 'circles', ids: [2] }, authorName: 'Me', createdAtMs: Date.parse(row.createdAt) });
    expect(fromRow({ ...row, authorId: 'someone' }, 'me')).toMatchObject({ mine: false, audience: undefined });
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
