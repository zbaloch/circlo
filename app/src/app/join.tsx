import { PeopleHub } from '@/components/people-hub';

/** People → Invite → Got an invite?: scan someone's QR code or paste their link, choose their circles, connect. */
export default function GotAnInviteScreen() {
  return <PeopleHub only="join" />;
}
