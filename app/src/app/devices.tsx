import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

export default function DevicesScreen() {
  return (
    <Screen>
      <EmptyState title="Devices" body="Link and revoke the devices that hold your keys." />
    </Screen>
  );
}
