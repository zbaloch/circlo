import { describeError, waitText } from '@/lib/account';
import { unseenSignIns } from '@/lib/security-events';

jest.mock('expo-secure-store', () => ({}));
jest.mock('@/api/client', () => ({}));
jest.mock('@circlo/core', () => ({}));

const at = (createdAt: string, id = createdAt) => ({ id, createdAt });

describe('unseenSignIns', () => {
  it('starts from the newest sign-in on a phone with no marker (its own), alerting about nothing', () => {
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
  const wrong = (extra: object) => Object.assign(new Error('AuthFailed'), { tag: 'AuthFailed', ...extra });

  it('counts down the tries left, then says the login is locked and points to the recovery phrase', () => {
    expect(describeError(wrong({ attemptsLeft: 2 }))).toBe('Wrong handle or password. 2 tries left before password login locks for a while.');
    expect(describeError(wrong({ attemptsLeft: 1 }))).toMatch(/1 try left/);
    expect(describeError(wrong({ attemptsLeft: 0, lockSeconds: 900 }))).toBe(
      'Wrong handle or password. Password login is now locked for 15 minutes. Use your recovery phrase to get in now.',
    );
  });

  it('explains a lock that is already in force', () => {
    expect(describeError({ code: 'locked', retryAfter: 3600 })).toBe(
      'Too many wrong passwords, so password login is locked for 1 hour. Use your recovery phrase to get in now.',
    );
  });
});
