import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, ok, setAccessToken, setRefresher } from '@/api/client';

import { resetAddressBookCache } from './addressbook';
import { clearAccount, loadAccount, updateRefreshToken, type StoredAccount } from './keystore';
import { clearFeed } from './feed-store';
import { clearMediaCache } from './media';
import { clearMessaging } from './messaging';
import { resetPush } from './push';
import { clearOutbox } from './outbox';

type State = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; account: StoredAccount };

type Session = State & {
  signIn: (account: StoredAccount) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

/** Rotates the stored refresh token for a fresh in-memory access token. */
async function refresh(account: StoredAccount) {
  const tokens = ok(await api.POST('/v1/auth/refresh', { body: { refreshToken: account.refreshToken } }));
  setAccessToken(tokens.accessToken!);
  await updateRefreshToken(tokens.refreshToken!);
  return { ...account, refreshToken: tokens.refreshToken! };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const account = await loadAccount();
      if (!account) {
        if (!cancelled) setState({ status: 'signedOut' });
        return;
      }
      try {
        const fresh = await refresh(account);
        if (!cancelled) setState({ status: 'signedIn', account: fresh });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // Session revoked (e.g. password changed elsewhere): log in again; the keys come back from the backup.
          await clearAccount();
          if (!cancelled) setState({ status: 'signedOut' });
        } else if (!cancelled) {
          // Offline: keys are on the device, so stay signed in and retry the session later.
          setState({ status: 'signedIn', account });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback((account: StoredAccount) => setState({ status: 'signedIn', account }), []);

  // While signed in, expired access tokens are renewed transparently (api/client retries the failed call once).
  const signedIn = state.status === 'signedIn';
  useEffect(() => {
    if (!signedIn) {
      setRefresher(null);
      return;
    }
    setRefresher(async () => {
      const account = await loadAccount();
      if (!account) return null;
      try {
        const tokens = ok(await api.POST('/v1/auth/refresh', { body: { refreshToken: account.refreshToken } }));
        setAccessToken(tokens.accessToken!);
        await updateRefreshToken(tokens.refreshToken!);
        return tokens.accessToken!;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // The session was revoked elsewhere: sign in again (keys come back from the backup).
          await clearAccount();
          setAccessToken(null);
          setState({ status: 'signedOut' });
        }
        return null;
      }
    });
    return () => setRefresher(null);
  }, [signedIn]);

  const signOut = useCallback(async () => {
    // Tell the server to forget this device (no more pushes, removed from chats). Best effort: still sign out offline.
    const current = await loadAccount();
    if (current) {
      await api.DELETE('/v1/devices/{deviceId}', { params: { path: { deviceId: current.deviceId } } }).catch(() => undefined);
    }
    await clearAccount();
    setAccessToken(null);
    resetAddressBookCache();
    clearOutbox();
    clearFeed();
    resetPush();
    await clearMessaging().catch(() => {});
    try {
      clearMediaCache(); // decrypted photos must not outlive the session
    } catch {
      // best effort: the OS may already have purged the cache
    }
    setState({ status: 'signedOut' });
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
