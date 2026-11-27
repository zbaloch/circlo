import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { ContentText } from '@/components/content-text';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { SourceTile } from '@/components/reading-ui';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { pickOpmlText, shareOpml } from '@/lib/opml-file';
import {
  describeReadingError,
  exportOpml,
  importOpml,
  importSummary,
  loadSources,
  READING_ABOUT,
  siteName,
  sourceStatus,
  unfollowSource,
  type Source,
} from '@/lib/reading';
import { showToast } from '@/lib/toast';
import { useNow } from '@/lib/use-now';
import { usePalette } from '@/theme/use-palette';

/**
 * Manage sources: what I follow, by name, with when each was last read (or that it can't be). Tapping one shows its
 * articles; ⋯ unfollows. The header's ⋯ moves sources to and from other readers (OPML).
 */
export default function SourcesScreen() {
  const navigation = useNavigation();
  const palette = usePalette();
  const now = useNow();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<SheetAction[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    loadSources().then(
      (s) => {
        setSources(s);
        setError(undefined);
      },
      () => {
        setSources((s) => s ?? []);
        setError('Couldn’t load your sources. Try again in a moment.');
      },
    );
  }, []);
  useFocusEffect(load);

  const doImport = useCallback(async () => {
    try {
      const text = await pickOpmlText();
      if (text === null) return;
      setBusy(true);
      showToast(importSummary(await importOpml(text)));
      load();
    } catch (e) {
      showToast(describeReadingError(e));
    } finally {
      setBusy(false);
    }
  }, [load]);

  const doExport = useCallback(async () => {
    try {
      await shareOpml(await exportOpml());
    } catch (e) {
      showToast(describeReadingError(e));
    }
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View className="flex-row items-center pr-2">
          <IconButton accessibilityLabel="Add a source" onPress={() => router.push('/feeds/add')}>
            <Icon name="add" size={24} color={palette.ink} />
          </IconButton>
          <IconButton
            accessibilityLabel="More"
            onPress={() =>
              setSheet([
                { label: 'Import from another reader (OPML)', onPress: () => void doImport() },
                // Export only once there's something to export.
                ...(sources?.length ? [{ label: 'Export your sources (OPML)', onPress: () => void doExport() }] : []),
              ])
            }>
            <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
          </IconButton>
        </View>
      ),
    });
  }, [navigation, palette.ink, doImport, doExport, sources?.length]);

  const unfollow = (s: Source) =>
    showAlert(`Unfollow ${s.title}?`, 'Its articles leave Feeds. You can follow it again any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unfollow',
        style: 'destructive',
        onPress: async () => {
          try {
            await unfollowSource(s.sourceId);
            setSources((all) => all?.filter((x) => x.sourceId !== s.sourceId) ?? null);
            showToast(`Unfollowed ${s.title}`);
          } catch (e) {
            showToast(describeReadingError(e));
          }
        },
      },
    ]);

  if (sources === null || busy) return <Spinner className="flex-1 bg-surface py-10 dark:bg-surface-dark" />;

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      {sources.length === 0 ? (
        <EmptyState icon="rss-outline" title="No sources yet" body={READING_ABOUT} actionLabel="Add a source" onAction={() => router.push('/feeds/add')} />
      ) : (
        <ScrollView contentContainerClassName="pb-10">
          {error ? <Text className="px-4 py-2 text-center text-sm text-danger dark:text-danger-dark">{error}</Text> : null}
          {sources.map((s) => (
            <Pressable
              key={s.sourceId}
              accessibilityRole="button"
              accessibilityHint="Shows its articles"
              onPress={() => router.navigate({ pathname: '/feeds', params: { source: s.sourceId } })}
              className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
              <SourceTile id={s.sourceId} title={s.title} icon={s.icon} />
              <View className="flex-1">
                <ContentText text={s.title} links={false} numberOfLines={1} className="text-base font-bold text-ink dark:text-ink-dark" />
                <Text numberOfLines={1} className="text-sm text-muted dark:text-muted-dark">
                  {siteName(s.siteUrl ?? s.feedUrl)} · {sourceStatus(s, now)}
                </Text>
              </View>
              <IconButton accessibilityLabel={`More about ${s.title}`} onPress={() => setSheet([{ label: 'Unfollow', destructive: true, onPress: () => unfollow(s) }])}>
                <Icon name="ellipsis-horizontal" size={20} color={palette.muted} />
              </IconButton>
            </Pressable>
          ))}
          <Text className="px-5 pt-4 text-sm text-muted dark:text-muted-dark">Only you can see what you follow.</Text>
        </ScrollView>
      )}
      <ActionSheet actions={sheet} onClose={() => setSheet(null)} />
    </View>
  );
}
