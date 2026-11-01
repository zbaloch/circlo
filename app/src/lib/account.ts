/**
 * Signing up and in: a name, username, email and password; the email is verified with a 6-digit code; a forgotten
 * password is reset with a code sent by email. The server keeps only a hash of the password.
 */
import { api, ApiError, ok, setAccessToken, withToken } from '@/api/client';

import { saveAccount, updateRefreshToken, type StoredAccount } from './keystore';
import { setMe } from './me';

type Tokens = { userId: string; deviceId: string; accessToken: string; refreshToken: string };

/** Human-readable messages for failures; never includes what was typed. */
export function describeError(e: unknown): string {
  const err = e as Partial<ApiError> | undefined;
  switch (err?.code) {
    case 'username_taken':
      return 'That username is taken. Try another.';
    case 'email_taken':
      return 'There’s already a Circlo account with this email. Log in, or reset your password.';
    case 'invalid_username':
      return 'Usernames are 3–30 characters: letters, numbers and _.';
    case 'invalid_email':
      return 'That doesn’t look like an email address.';
    case 'invalid_name':
      return 'Enter your name (up to 50 characters).';
    case 'invalid_bio':
      return 'Your bio can be up to 160 characters.';
    case 'weak_password':
      return 'Choose a password of at least 12 characters.';
    case 'invalid_code':
      return 'That code isn’t right. Check the latest email from Circlo, or send a new code.';
    case 'code_expired':
      return 'That code has expired. Send a new one.';
    case 'rate_limited':
      return 'Too many attempts. Wait a little and try again.';
    case 'wrong_password':
      return 'That isn’t your current password.';
    case 'email_not_verified':
      return 'Confirm your email first: we’ve sent you a new code.';
    case 'locked': {
      const wait = err.details?.retryAfter;
      return `Too many wrong passwords, so login is locked${wait ? ` for ${waitText(wait)}` : ' for now'}. Reset your password by email to get in now.`;
    }
    case 'unauthorized': {
      const left = err.details?.attemptsLeft;
      if (left === 0) {
        const lock = err.details?.lockSeconds;
        return `Wrong username or password. Login is now locked${lock ? ` for ${waitText(lock)}` : ''}. You can reset your password by email.`;
      }
      if (left !== undefined) return `Wrong username or password. ${left} ${left === 1 ? 'try' : 'tries'} left before login locks for a while.`;
      return 'Wrong username or password.';
    }
  }
  if (e instanceof TypeError) return 'Can’t reach the Circlo server. Check your connection.';
  return 'Something went wrong. Please try again.';
}

/** "1 minute", "15 minutes", "1 hour", "24 hours", rounded up. Exported for tests. */
export function waitText(seconds: number): string {
  if (seconds < 3600) {
    const m = Math.max(1, Math.ceil(seconds / 60));
    return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  }
  const h = Math.ceil(seconds / 3600);
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** Usernames as the server accepts them: lowercase, no leading @. Pure; returns null if invalid. */
export function normalizeUsername(raw: string): string | null {
  const u = raw.trim().toLowerCase().replace(/^@/, '');
  return /^[a-z0-9_]{3,30}$/.test(u) ? u : null;
}

export function looksLikeEmail(raw: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.trim());
}

/** Stores a new session on this device. */
async function persist(tokens: Tokens): Promise<StoredAccount> {
  const me = ok(await api.GET('/v1/me', withToken(tokens.accessToken)));
  const account: StoredAccount = { userId: tokens.userId, deviceId: tokens.deviceId, handle: me.username, refreshToken: tokens.refreshToken };
  await saveAccount(account);
  setAccessToken(tokens.accessToken);
  setMe(me);
  return account;
}

// ---------------- sign up ----------------

export type SignupForm = { username: string; email: string; password: string };

/** Starts a signup: Circlo emails a code to the address. Returns the address the code went to. */
export async function startSignup(form: SignupForm): Promise<string> {
  const res = ok(await api.POST('/v1/auth/signup', { body: { ...form, email: form.email.trim() } }));
  return res.email;
}

/** Finishes the signup with the code from the email and signs in. */
export async function verifyEmail(email: string, code: string): Promise<StoredAccount> {
  return persist(ok(await api.POST('/v1/auth/signup/verify', { body: { email, code: code.trim() } })));
}

export async function resendCode(email: string): Promise<void> {
  ok(await api.POST('/v1/auth/signup/resend', { body: { email } }));
}

// ---------------- log in ----------------

/** Logs in with a username or email. An unverified email throws `email_not_verified` (with the address in details). */
export async function login(loginName: string, password: string): Promise<StoredAccount> {
  return persist(ok(await api.POST('/v1/auth/login', { body: { login: loginName.trim(), password } })));
}

// ---------------- passwords ----------------

export async function forgotPassword(email: string): Promise<void> {
  ok(await api.POST('/v1/auth/password/forgot', { body: { email: email.trim() } }));
}

/** Sets a new password with the emailed code. Every other device is signed out; this one signs in. */
export async function resetPassword(email: string, code: string, password: string): Promise<StoredAccount> {
  return persist(ok(await api.POST('/v1/auth/password/reset', { body: { email: email.trim(), code: code.trim(), password } })));
}

/** Changes the password. The server signs out every other device; this one keeps going with a fresh session. */
export async function changePassword(current: string, next: string): Promise<void> {
  const tokens = ok(await api.POST('/v1/auth/password/change', { body: { currentPassword: current, newPassword: next } }));
  setAccessToken(tokens.accessToken);
  await updateRefreshToken(tokens.refreshToken);
}
