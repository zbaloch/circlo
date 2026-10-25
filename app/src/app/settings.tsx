import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

export default function SettingsScreen() {
  return (
    <Screen>
      <EmptyState title="Settings" body="Settings are encrypted and synced only between your devices." />
    </Screen>
  );
}
