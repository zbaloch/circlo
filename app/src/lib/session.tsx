import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { api, ApiError, ok, setAccessToken, setRefresher } from '@/api/client';

import { forgetActivity } from './activity';
import { resetAddressBookCache } from './addressbook';
import { stopLocally as stopBackgroundChecks } from './background-check';
import { clearFeed } from './feed-store';
import { clearAccount, loadAccount, updateRefreshToken, type StoredAccount } from './keystore';
import { refreshMe, setMe } from './me';
import { clearMediaCache } from './media';
import { clearMessaging } from './messaging';
import { clearOutbox } from './outbox';
import { forgetSignIns } from './security-events';
import { forgetConnections } from './use-connections';
import { digestHourUtc } from './time';

type State = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; account: StoredAccount };

type Session = State & {
  signIn: (account: StoredAccount) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

/**
 * Removes everything the account left on this device: the session, cached people and posts, picked media and local
 * markers. Used by sign-out and when the server ends the session, so both leave nothing behind for the next account.
 */
async function wipeDevice() {
  const current = await loadAccount();
  await clearAccount();
  setAccessToken(null);
  setMe(null);
  resetAddressBookCache();
  clearOutbox();
  clearFeed();
  clearMessaging();
  await stopBackgroundChecks();
  if (current) {
    await forgetConnections(current.userId).catch(() => {});
    await forgetSignIns(current.userId);
    await forgetActivity(current.userId);
  }
  try {
    clearMediaCache();
  } catch {
    // best effort: the OS may already have purged the cache
  }
}

/** Rotates the stored refresh token for a fresh in-memory access token. */
async function refresh(account: StoredAccount) {
  const tokens = ok(await api.POST('/v1/auth/refresh', { body: { refreshToken: account.refreshToken } }));
  setAccessToken(tokens.accessToken);
  await updateRefreshToken(tokens.refreshToken);
  return { ...account, refreshToken: tokens.refreshToken };
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
        refreshMe().catch(() => {});
        if (!cancelled) setState({ status: 'signedIn', account: fresh });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // Session ended elsewhere (signed out, password changed or reset): log in again.
          await wipeDevice();
          if (!cancelled) setState({ status: 'signedOut' });
        } else if (!cancelled) {
          // Offline: stay signed in and retry the session when a request needs it.
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
        setAccessToken(tokens.accessToken);
        await updateRefreshToken(tokens.refreshToken);
        return tokens.accessToken;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await wipeDevice();
          setState({ status: 'signedOut' });
        }
        return null;
      }
    });
    // Which kind of app this sign-in is (only that): the server tells me about activity by push while I have the phone
    // app, and by email while I only use the web. Sent on every launch, so sign-ins from before this was asked catch up.
    api.PUT('/v1/devices/current', { body: { kind: deviceKind(Platform.OS) } }).catch(() => undefined);
    // The daily notification comes around 6pm here; sent on every launch so travel and clock changes catch up.
    api.PUT('/v1/me/notifications', { body: { digestHour: digestHourUtc(new Date().getTimezoneOffset()) } }).catch(() => undefined);
    return () => setRefresher(null);
  }, [signedIn]);

  const signOut = useCallback(async () => {
    // Tell the server to end this device's session. Best effort: still sign out offline.
    await api.POST('/v1/auth/logout').catch(() => undefined);
    await wipeDevice();
    setState({ status: 'signedOut' });
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function deviceKind(os: string): 'ios' | 'android' | 'web' {
  return os === 'ios' || os === 'android' ? os : 'web';
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
