import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

export default function SearchScreen() {
  return (
    <Screen>
      <EmptyState
        title="Find friends"
        body="Scan a friend's invite QR code or share yours. Handles are only searchable if a friend turns that on."
        actionLabel="Share my invite"
      />
    </Screen>
  );
}
