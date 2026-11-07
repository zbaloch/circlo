import { PeopleHub } from '@/components/people-hub';

/** People → Invite → Invite someone: my QR code and link (the same until I reset it), and who just joined with it. */
export default function InviteSomeoneScreen() {
  return <PeopleHub only="invite" />;
}
