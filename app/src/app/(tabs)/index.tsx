import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { Screen } from '@/components/screen';

export default function HomeScreen() {
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
