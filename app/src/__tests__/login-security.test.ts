import { ApiError } from '@/api/client';
import { describeError, looksLikeEmail, normalizeUsername, waitText } from '@/lib/account';
import { unseenSignIns } from '@/lib/security-events';

jest.mock('@/lib/storage', () => ({}));
jest.mock('@/api/client', () => {
  class ApiError extends Error {
    readonly code: string;
    readonly details: object;
    constructor(_httpStatus: number, code: string, details: object = {}) {
      super(code);
      this.code = code;
      this.details = details;
    }
  }
  return { ApiError };
});

const at = (createdAt: string, id = createdAt) => ({ id, createdAt });

describe('unseenSignIns', () => {
  it('starts from the newest sign-in on a device with no marker (its own), alerting about nothing', () => {
    expect(unseenSignIns([at('2026-10-30T10:00:00Z'), at('2026-10-30T12:00:00Z')], null)).toEqual({
      unseen: [],
      marker: '2026-10-30T12:00:00Z',
    });
    expect(unseenSignIns([], null).unseen).toEqual([]);
  });

  it('alerts about sign-ins after the marker, oldest first', () => {
    const r = unseenSignIns([at('2026-10-30T14:00:00.5Z'), at('2026-10-30T12:00:00Z'), at('2026-10-30T13:00:00Z')], '2026-10-30T12:00:00.000Z');
    expect(r.unseen.map((e) => e.createdAt)).toEqual(['2026-10-30T13:00:00Z', '2026-10-30T14:00:00.5Z']);
  });

  it('ignores sign-ins already dealt with', () => {
    expect(unseenSignIns([at('2026-10-30T12:00:00Z')], '2026-10-30T12:00:00Z').unseen).toEqual([]);
  });
});

describe('waitText', () => {
  it('rounds up to minutes or hours', () => {
    expect(waitText(30)).toBe('1 minute');
    expect(waitText(899)).toBe('15 minutes');
    expect(waitText(3600)).toBe('1 hour');
    expect(waitText(86_000)).toBe('24 hours');
  });
});

describe('login error messages', () => {
  const wrong = (details: object) => new ApiError(401, 'unauthorized', details);

  it('counts down the tries left, then says login is locked and points to a password reset', () => {
    expect(describeError(wrong({ attemptsLeft: 2 }))).toBe('Wrong username or password. 2 tries left before login locks for a while.');
    expect(describeError(wrong({ attemptsLeft: 1 }))).toMatch(/1 try left/);
    expect(describeError(wrong({ attemptsLeft: 0, lockSeconds: 900 }))).toBe(
      'Wrong username or password. Login is now locked for 15 minutes. You can reset your password by email.',
    );
  });

  it('explains a lock that is already in force', () => {
    expect(describeError(new ApiError(429, 'locked', { retryAfter: 3600 }))).toBe(
      'Too many wrong passwords, so login is locked for 1 hour. Reset your password by email to get in now.',
    );
  });

  it('explains signup problems', () => {
    expect(describeError(new ApiError(409, 'username_taken'))).toMatch(/username is taken/);
    expect(describeError(new ApiError(409, 'email_taken'))).toMatch(/already a Circlo account/);
    expect(describeError(new ApiError(400, 'invalid_code'))).toMatch(/code isn’t right/);
  });
});

describe('what people type', () => {
  it('normalizes usernames and checks emails', () => {
    expect(normalizeUsername(' @Sam_K ')).toBe('sam_k');
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('bad-name')).toBeNull();
    expect(looksLikeEmail('sam@example.com')).toBe(true);
    expect(looksLikeEmail('sam@example')).toBe(false);
  });
});
