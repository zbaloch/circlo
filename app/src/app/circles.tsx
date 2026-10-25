import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

export default function CirclesScreen() {
  return (
    <Screen>
      <EmptyState title="Circles" body="Arrange friends into circles. Nobody is ever told which circle they are in." />
    </Screen>
  );
}
