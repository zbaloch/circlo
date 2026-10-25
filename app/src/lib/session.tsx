import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, ok, setAccessToken } from '@/api/client';

import { clearAccount, loadAccount, updateRefreshToken, type StoredAccount } from './keystore';

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

  const signOut = useCallback(async () => {
    await clearAccount();
    setAccessToken(null);
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
