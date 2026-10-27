import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from './schema';

/** API base URL from app/.env (EXPO_PUBLIC_API_URL). The Android emulator reaches the dev machine at 10.0.2.2. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080';

let accessToken: string | null = null;

/** Access tokens live in memory only; refresh tokens are in the keystore. */
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
    if (request.headers.has('Authorization')) return request; // an explicit token (e.g. recovery scope)
    if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`);
    // Session calls (not login/refresh themselves) can be retried once after renewing an expired or missing token.
    if (refresher && !new URL(request.url).pathname.startsWith('/v1/auth/')) retryable.set(request, request.clone());
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

/** A failed API call. `code` is the server's fixed error code (never contains request data). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Unwraps an openapi-fetch result, throwing ApiError on failure. */
export function ok<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined && result.response.ok) return result.data;
  const code = (result.error as { error?: string } | undefined)?.error ?? `http_${result.response.status}`;
  throw new ApiError(result.response.status, code);
}

/** Calls with a specific bearer token (e.g. a recovery-scoped token) instead of the current session. */
export function withToken(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}
