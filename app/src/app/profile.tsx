import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

export default function ProfileScreen() {
  return (
    <Screen>
      <EmptyState title="Profile" body="Your profile is encrypted and visible only to your friends." />
    </Screen>
  );
}
