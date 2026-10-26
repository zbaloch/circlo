import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { describeError } from './account';
import { syncConnections, type Connection } from './friends';
import { useSession } from './session';

/** Connections (requests + friends), refreshed whenever the screen gains focus. */
export function useConnections() {
  const session = useSession();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string>();
  const account = session.status === 'signedIn' ? session.account : null;

  const refresh = useCallback(() => {
    if (!account) return Promise.resolve();
    return syncConnections(account).then(
      (c) => {
        setConnections(c);
        setError(undefined);
      },
      (e) => setError(describeError(e)),
    );
  }, [account]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { account, connections, error, refresh };
}

export function displayName(c: Connection): string {
  return c.profile?.displayName || (c.profile?.handle ? `@${c.profile.handle}` : 'Someone');
}
