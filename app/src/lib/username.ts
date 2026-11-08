/**
 * Username rules, explained as you type (owner request 2026-11-08: people struggled with "Z.A_Soomro"). The server's
 * rule is the real check (Accounts.USERNAME: 3–30 of a–z, 0–9 and _); this only says what's wrong, early. Capitals are
 * made small without a message; anything else that isn't allowed is named, with a fix to tap.
 */
export type UsernameCheck = {
  /** What people will see after the @: lowercase, without a typed leading @. */
  handle: string;
  ok: boolean;
  /** What's wrong, in words; none while the field is empty. */
  problem?: string;
  /** The same username with what isn't allowed swapped for _, when that makes a valid one. */
  suggestion?: string;
};

const VALID = /^[a-z0-9_]{3,30}$/;

export function checkUsername(raw: string): UsernameCheck {
  const handle = raw.toLowerCase().replace(/^@/, '');
  if (!handle) return { handle, ok: false };
  // Each character that isn't allowed, once, in the order typed (whole characters, so an emoji isn't split).
  const bad = [...new Set([...handle.normalize('NFC')].filter((c) => !/[a-z0-9_]/.test(c)))];
  if (bad.length) {
    const named = bad.some((c) => /\s/.test(c)) ? ['spaces', ...bad.filter((c) => !/\s/.test(c)).map((c) => `"${c}"`)] : bad.map((c) => `"${c}"`);
    const list = named.length > 1 ? `${named.slice(0, -1).join(', ')} or ${named[named.length - 1]}` : named[0];
    const fixed = handle
      .trim()
      .normalize('NFD')
      .replace(/\p{M}/gu, '') // accents: ë → e
      .replace(/[^a-z0-9_]+/g, '_')
      .slice(0, 30);
    return {
      handle,
      ok: false,
      problem: `Usernames can’t have ${list} – only letters, numbers and _.`,
      ...(VALID.test(fixed) ? { suggestion: fixed } : {}),
    };
  }
  if (handle.length < 3) return { handle, ok: false, problem: 'At least 3 characters.' };
  if (handle.length > 30) return { handle, ok: false, problem: 'Up to 30 characters.' };
  return { handle, ok: true };
}
