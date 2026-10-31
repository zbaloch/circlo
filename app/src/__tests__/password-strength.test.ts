import { checkPassword, MIN_PASSWORD } from '@/lib/password-strength';

// The first password check loads zxcvbn's dictionaries (~1 MB); give it room when the whole suite runs in parallel.
jest.setTimeout(20_000);

describe('checkPassword', () => {
  it('needs at least 12 characters', () => {
    expect(MIN_PASSWORD).toBe(12);
    const r = checkPassword('k7#Qz!p2');
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/at least 12 characters/);
  });

  it('refuses passwords from breach lists, even long ones', () => {
    // In zxcvbn's own list, and only in the NCSC top-100k list we add (not in zxcvbn's).
    for (const pw of ['password1234', 'qwertyuiop123', '123456789asdf']) { // gitleaks:allow (public breached passwords the check must refuse)
      const r = checkPassword(pw);
      expect(r.ok).toBe(false);
    }
    expect(checkPassword('123456789asdf').problem).toMatch(/data breaches/);
  });

  it('refuses easy-to-guess patterns', () => {
    for (const pw of ['aaaaaaaaaaaa', 'abcdefghijkl', 'qwertyqwerty', '111122223333', 'Password2026!']) {
      expect(checkPassword(pw).ok).toBe(false);
    }
  });

  it('refuses a password built from the handle', () => {
    expect(checkPassword('sofia_martins2026', 'sofia_martins').ok).toBe(false);
  });

  it('accepts a few random words or a long random string, with no symbol rules', () => {
    expect(checkPassword('copper lantern violet harbour')).toMatchObject({ ok: true });
    expect(checkPassword('tq8vz3mwk2rx9p')).toMatchObject({ ok: true });
  });

  it('scores 0–4 for the strength meter', () => {
    expect(checkPassword('').score).toBe(0);
    expect(checkPassword('copper lantern violet harbour').score).toBeGreaterThanOrEqual(3);
  });
});
