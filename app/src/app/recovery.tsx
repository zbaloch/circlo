import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

export default function RecoveryScreen() {
  return (
    <Screen>
      <EmptyState icon="key-outline" title="Recovery phrase" body="Your 24-word phrase is the only way back in if you forget your password." />
    </Screen>
  );
}
