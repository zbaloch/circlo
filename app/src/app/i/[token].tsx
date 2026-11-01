import { Redirect, useLocalSearchParams } from 'expo-router';

import { INVITE_HOST } from '@/lib/friends';
import { setPendingInvite } from '@/lib/pending-invite';
import { useSession } from '@/lib/session';

/**
 * An invite link (https://www.hellocirclo.com/i/<token> opened in the app, or app.hellocirclo.com/i/<token> in the
 * web app). It's kept until the person is signed in, then offered on "Got an invite?".
 */
export default function InviteLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const session = useSession();
  if (token) setPendingInvite(`${INVITE_HOST}${token}`);
  if (session.status === 'loading') return null;
  return session.status === 'signedIn' ? <Redirect href={{ pathname: '/search', params: { section: 'join' } }} /> : <Redirect href="/welcome" />;
}
