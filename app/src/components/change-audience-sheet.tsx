import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { AudiencePicker, audienceLine, Sheet } from '@/components/audience-sheet';
import { Button, ErrorText } from '@/components/form';
import { Text } from '@/components/ui/text';
import type { AddressBook, Audience } from '@/lib/addressbook';
import { audienceLabel } from '@/lib/circles';
import { changeAudience, sameAudience, type FeedPost } from '@/lib/posts';

/**
 * "Change who can see this" for my own post: the compose audience picker, starting from the post's audience. Saving
 * takes effect at once (the server decides who sees it); people added see it with its replies, people removed lose
 * it, and nobody is told. Only the author ever sees this.
 */
export function ChangeAudienceSheet({ visible, book, post, onClose, onSaved }: {
  visible: boolean;
  book: AddressBook;
  post: FeedPost;
  onClose: () => void;
  onSaved: (post: FeedPost) => void;
}) {
  const [audience, setAudience] = useState<Audience | null>(post.audience ?? null);
  const [busy, setBusy] = useState(false);
  // Mounted fresh each time it opens (usePostActions), so it always starts from the post's audience.
  const [error, setError] = useState<string>();

  const save = async () => {
    if (!audience) return;
    setBusy(true);
    setError(undefined);
    try {
      onSaved(await changeAudience(post, audience));
    } catch {
      setError('Couldn’t change it. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Who can see this post?">
      <Text className="px-5 pb-2 text-sm text-muted dark:text-muted-dark">
        Changes straight away. People you add see it with its replies; people you remove can’t see it any more. Nobody is told.
      </Text>
      <ScrollView>
        <AudiencePicker book={book} selected={audience} onChange={setAudience} />
      </ScrollView>
      <View className="gap-2 border-t border-border px-5 pt-3 dark:border-border-dark">
        <Text className="text-center text-sm text-muted dark:text-muted-dark">
          {audience ? `${audienceLabel(book, audience)} · ${audienceLine(book, audience)}` : 'Choose who can see this post.'}
        </Text>
        <ErrorText>{error}</ErrorText>
        <Button label="Save" loading={busy} disabled={!audience || sameAudience(audience, post.audience)} onPress={save} />
      </View>
    </Sheet>
  );
}
