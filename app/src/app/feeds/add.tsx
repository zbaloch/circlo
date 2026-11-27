import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, ErrorText, TextField } from '@/components/form';
import { SourceTile } from '@/components/reading-ui';
import { ContentText } from '@/components/content-text';
import { Text } from '@/components/ui/text';
import { describeReadingError, findSource, followSource, siteName, type FoundSource } from '@/lib/reading';
import { relativeTime } from '@/lib/time';
import { showToast } from '@/lib/toast';

/**
 * Add a source: paste a site's address (or its feed link); Circlo finds the feed, shows its name and latest articles,
 * and Follow adds it. Nobody needs to know what RSS is, and nobody else sees what you follow.
 */
export default function AddSourceScreen() {
  const [url, setUrl] = useState('');
  const [found, setFound] = useState<FoundSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const find = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setFound(await findSource(url.trim()));
    } catch (e) {
      setFound(null);
      setError(describeReadingError(e));
    } finally {
      setBusy(false);
    }
  };

  const follow = async () => {
    if (!found) return;
    setBusy(true);
    setError(undefined);
    try {
      const source = await followSource(found.feedUrl);
      showToast(`Following ${source.title}`);
      router.back();
    } catch (e) {
      setError(describeReadingError(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="gap-4 px-5 pb-10 pt-4" keyboardShouldPersistTaps="handled">
      <TextField
        label="Site or feed address"
        hint="Paste a site’s address or its feed link."
        placeholder="example.com"
        value={url}
        onChangeText={(t) => {
          setUrl(t);
          setFound(null);
          setError(undefined);
        }}
        keyboardType="url"
        returnKeyType="search"
        onSubmitEditing={find}
        autoFocus
      />
      <ErrorText>{error}</ErrorText>
      {found ? (
        <View className="gap-3 rounded-2xl border border-border p-4 dark:border-border-dark">
          <View className="flex-row items-center gap-3">
            <SourceTile id={found.feedUrl} title={found.title} size="lg" />
            <View className="flex-1">
              <ContentText text={found.title} links={false} numberOfLines={2} className="text-lg font-bold text-ink dark:text-ink-dark" />
              <Text className="text-muted dark:text-muted-dark">{siteName(found.siteUrl ?? found.feedUrl)}</Text>
            </View>
          </View>
          {found.articles.length === 0 ? (
            <Text className="text-muted dark:text-muted-dark">No articles yet. New ones will show in Feeds.</Text>
          ) : (
            found.articles.map((a, i) => (
              <View key={i} className="flex-row gap-2">
                <View className="flex-1">
                  <ContentText text={a.title} links={false} numberOfLines={1} className="text-[15px] text-ink dark:text-ink-dark" />
                </View>
                <Text className="text-[15px] text-muted dark:text-muted-dark">{relativeTime(Date.parse(a.publishedAt))}</Text>
              </View>
            ))
          )}
          {found.following ? (
            <Button label="Following" variant="outline" disabled onPress={() => {}} />
          ) : (
            <Button label="Follow" loading={busy} onPress={follow} />
          )}
        </View>
      ) : (
        <Button label="Find" loading={busy} disabled={!url.trim()} onPress={find} />
      )}
      <Text className="text-sm text-muted dark:text-muted-dark">
        Only you can see what you follow. Circlo checks your sources for you, so the sites don’t see you until you open an article.
      </Text>
    </ScrollView>
  );
}
