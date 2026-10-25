import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { Screen } from '@/components/screen';

export default function MessagesScreen() {
  return (
    <Screen>
      <EmptyState title="No messages" body="Messages are end-to-end encrypted. Start a chat with a friend or a group." />
      <Fab accessibilityLabel="New message" icon="mail-outline" />
    </Screen>
  );
}
