import { useState } from 'react';

import { describeError, type RecoveryChoice, type Signup } from './account';
import { useSession } from './session';
import { setPendingSignup } from './signup-store';

/**
 * Finishes a signup with the chosen recovery method (uploads keys and encrypted backups) and signs in. If the server
 * says the signup expired, nothing was saved: `expired` offers a clean restart.
 */
export function useFinishSignup() {
  const { signIn } = useSession();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  const finish = async (signup: Signup, choice: RecoveryChoice) => {
    setError(undefined);
    setBusy(true);
    try {
      const account = await signup.finish(choice);
      setPendingSignup(null);
      signIn(account);
    } catch (e) {
      setError(describeError(e));
      if ((e as { code?: string })?.code === 'registration_expired') {
        setPendingSignup(null);
        setExpired(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return { finish, error, setError, busy, setBusy, expired };
}
