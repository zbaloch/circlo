import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

export default function NotificationsScreen() {
  return (
    <Screen>
      <EmptyState title="Nothing yet" body="Friend requests, replies and likes show up here." />
    </Screen>
  );
}
