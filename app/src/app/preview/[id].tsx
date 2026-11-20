import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { authorName } from '@/components/post-actions';
import { PostCard } from '@/components/post-card';
import { loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { matesLine, previewCircleMates } from '@/lib/circle-mates';
import { previewAs, type FeedPost } from '@/lib/posts';
import { useSession } from '@/lib/session';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';

/**
 * "Preview as…" (PLAN.md Phase 8): my posts exactly as this friend sees them, decided by the server the same way it
 * decides for them, and shown the way they see it: no audience badge, no actions. Above them, the people they see on
 * my profile (people in the same circle; owner decision 2026-11-20).
 */
export default function PreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const navigation = useNavigation();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [mates, setMates] = useState<string[]>([]);

  useEffect(() => {
    if (!account) return;
    loadAddressBook(account).then((b) => {
      setBook(b);
      navigation.setOptions({ title: `As ${authorName(account, b, id).name}` });
    });
    previewAs(account, id).then((p) => setPosts(p.posts), () => setPosts([]));
    previewCircleMates(id).then((m) => setMates(m.map((x) => x.name)), () => setMates([]));
  }, [account, id, navigation]);

  if (!account) return null;
  const me = authorName(account, book, account.userId);
  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <Text className="border-b border-border bg-primary-soft px-4 py-3 text-sm text-ink dark:border-border-dark dark:bg-primary-soft-dark dark:text-ink-dark">
        This is what {authorName(account, book, id).name} sees of your posts. They never see circle names or numbers.
      </Text>
      {mates.length > 0 ? (
        <Text className="border-b border-border px-4 py-3 text-sm text-muted dark:border-border-dark dark:text-muted-dark">
          On your profile they also see <Text className="text-sm font-semibold text-ink dark:text-ink-dark">{matesLine(mates)}</Text>, people
          you’ve put in the same circle.
        </Text>
      ) : null}
      {posts === null ? (
        <Spinner className="py-10" />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.postId}
          ListEmptyComponent={<EmptyState icon="eye-outline" title="Nothing to see" body="None of your recent posts reach this person's circle." />}
          renderItem={({ item }) => <PostCard post={item} name={me.name} handle={me.handle} />}
        />
      )}
    </View>
  );
}
