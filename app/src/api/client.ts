import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from './schema';

/**
 * API base URL from app/.env (EXPO_PUBLIC_API_URL), baked in at build time. The Android emulator reaches the dev
 * machine at 10.0.2.2; the web app is built with its API host (e.g. https://api.hellocirclo.com).
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080';

let accessToken: string | null = null;

/** Access tokens live in memory only; refresh tokens are in device storage (lib/storage). */
export function setAccessToken(token: string | null) {
  accessToken = token;
}

type Refresher = () => Promise<string | null>;
let refresher: Refresher | null = null;
let refreshing: Promise<string | null> | null = null;

/**
 * The session's way to get a new access token (rotating the refresh token). Called when the server says the access
 * token expired; one refresh at a time, because a refresh token used twice revokes the session.
 */
export function setRefresher(fn: Refresher | null) {
  refresher = fn;
}

function refreshOnce(): Promise<string | null> {
  if (!refresher) return Promise.resolve(null);
  refreshing ??= refresher().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Unsent copies of session-authenticated requests, so an expired-token 401 can be retried once.
const retryable = new WeakMap<Request, Request>();

const auth: Middleware = {
  onRequest({ request }) {
    if (request.headers.has('Authorization')) return request; // an explicit token
    const path = new URL(request.url).pathname;
    // Signup, login, refresh and password reset are public: never send the (possibly expired) session token with them.
    const publicAuth = path.startsWith('/v1/auth/') && path !== '/v1/auth/password/change' && path !== '/v1/auth/logout';
    if (accessToken && !publicAuth) request.headers.set('Authorization', `Bearer ${accessToken}`);
    // Session calls (not login/refresh themselves) can be retried once after renewing an expired or missing token.
    if (refresher && !path.startsWith('/v1/auth/')) retryable.set(request, request.clone());
    return request;
  },
  async onResponse({ request, response }) {
    const copy = retryable.get(request);
    retryable.delete(request);
    if (response.status !== 401 || !copy) return undefined; // unchanged (openapi-fetch wants undefined, not the same object)
    const token = await refreshOnce();
    if (!token) return undefined;
    copy.headers.set('Authorization', `Bearer ${token}`);
    return fetch(copy);
  },
};

export const api = createClient<paths>({ baseUrl: API_URL });
api.use(auth);

/** Fixed details some errors carry (never request data). */
export type ErrorDetails = { attemptsLeft?: number; lockSeconds?: number; retryAfter?: number; email?: string };

/** A failed API call. `code` is the server's fixed error code (never contains request data). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: ErrorDetails = {},
  ) {
    super(code);
  }

  /** Seconds until a lock or rate limit lifts, when the server says. */
  get retryAfter(): number | undefined {
    return this.details.retryAfter;
  }
}

/** Unwraps an openapi-fetch result, throwing ApiError on failure. */
export function ok<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined && result.response.ok) return result.data;
  const { error, ...details } = (result.error ?? {}) as { error?: string } & ErrorDetails;
  throw new ApiError(result.response.status, error ?? `http_${result.response.status}`, details);
}

/** Calls with a specific bearer token (a session that isn't stored yet) instead of the current session. */
export function withToken(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}
