import { useEffect } from 'react';

import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { Screen } from '@/components/screen';
import { resumePendingRotation } from '@/lib/circles';
import { useSession } from '@/lib/session';

export default function HomeScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  // Finish any key rotation that was interrupted (app closed mid-way, offline): it retries quietly in the background.
  useEffect(() => {
    if (account) resumePendingRotation(account).catch(() => {});
  }, [account]);
  return (
    <Screen>
      <EmptyState
        title="Your timeline is quiet"
        body="Posts from friends appear here. Only people in the circles you choose can read what you share."
        actionLabel="Invite your first friend"
      />
      <Fab accessibilityLabel="Compose post" icon="add" />
    </Screen>
  );
}
