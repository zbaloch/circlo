import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from './schema';

/** API base URL from app/.env (EXPO_PUBLIC_API_URL). The Android emulator reaches the dev machine at 10.0.2.2. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080';

let accessToken: string | null = null;

/** Access tokens live in memory only; refresh tokens are in the keystore. */
export function setAccessToken(token: string | null) {
  accessToken = token;
}

const auth: Middleware = {
  onRequest({ request }) {
    if (accessToken && !request.headers.has('Authorization')) {
      request.headers.set('Authorization', `Bearer ${accessToken}`);
    }
    return request;
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
