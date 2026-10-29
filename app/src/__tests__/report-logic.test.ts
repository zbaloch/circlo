import { REPORT_REASONS, reportBody, type ReportedPost } from '@/lib/report';

// Native modules don't load under jest; these tests cover the pure report body only.
jest.mock('@circlo/core', () => ({}));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-video-thumbnails', () => ({}));
jest.mock('expo-secure-store', () => ({}));

const post: ReportedPost = {
  postId: 'p1',
  authorId: 'a1',
  authorName: 'Maira',
  authorHandle: 'maira',
  createdAtMs: Date.UTC(2026, 9, 29, 8, 0),
  text: 'something abusive',
  videos: 1,
};

const decode = (bytes: ArrayBuffer) => JSON.parse(new TextDecoder().decode(bytes));

describe('report body', () => {
  it('carries what the reporter saw: the post, who wrote it, the reason and an optional note', () => {
    const body = decode(reportBody({ reason: 'harassment', note: '  keeps happening ', subject: { kind: 'post', post, photos: ['data:image/jpeg;base64,AAAA'] } }));
    expect(body).toMatchObject({
      v: 1,
      kind: 'post',
      reason: 'harassment',
      note: 'keeps happening',
      post: { postId: 'p1', authorId: 'a1', authorName: 'Maira', authorHandle: 'maira', text: 'something abusive', videos: 1 },
    });
    expect(body.post.createdAt).toBe('2026-10-29T08:00:00.000Z');
    expect(body.post.photos).toEqual(['data:image/jpeg;base64,AAAA']);
  });

  it('leaves out photos that would push the report over its size limit, and says so', () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(2_000_000)}`;
    const body = decode(reportBody({ reason: 'spam', note: '', subject: { kind: 'post', post, photos: [big, big, 'data:image/jpeg;base64,BB'] } }));
    expect(body.post.photos).toHaveLength(2);
    expect(body.post.photosLeftOut).toBe(1);
    expect(body.note).toBeUndefined();
  });

  it('only accepts known reasons and caps the note', () => {
    expect(() => reportBody({ reason: 'nope' as never, note: '', subject: { kind: 'post', post, photos: [] } })).toThrow();
    expect(decode(reportBody({ reason: 'other', note: 'x'.repeat(5000), subject: { kind: 'post', post, photos: [] } })).note).toHaveLength(1000);
    expect(REPORT_REASONS.map((r) => r.id)).toContain('child_safety');
    expect(() => reportBody({ reason: 'spam', note: '', subject: { kind: 'nope' } as never })).toThrow();
  });

  it('reports a person by their profile as the reporter sees it', () => {
    const body = decode(reportBody({ reason: 'hate', note: '', subject: { kind: 'user', user: { userId: 'u1', name: 'Bob', handle: 'bob', bio: 'hi' } } }));
    expect(body).toMatchObject({ kind: 'user', reason: 'hate', user: { userId: 'u1', name: 'Bob', handle: 'bob', bio: 'hi' } });
    expect(body.post).toBeUndefined();
  });

  it('reports one chat message with who sent it, and nothing else from the chat', () => {
    const message = { chatId: 'g1', seq: 7, senderId: 'u1', senderName: 'Bob', createdAtMs: Date.UTC(2026, 9, 29, 9, 0), text: 'go away', videos: 0 };
    const body = decode(reportBody({ reason: 'harassment', note: '', subject: { kind: 'message', message, photos: [] } }));
    expect(body).toMatchObject({ kind: 'message', message: { chatId: 'g1', seq: 7, senderId: 'u1', senderName: 'Bob', text: 'go away', photos: [] } });
    expect(body.message.createdAt).toBe('2026-10-29T09:00:00.000Z');
  });
});
