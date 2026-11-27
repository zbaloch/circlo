import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { ArticleRow, ChipBar } from '@/components/reading-ui';
import { Screen } from '@/components/screen';
import { SendToChatSheet } from '@/components/send-to-chat-sheet';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { CHAT_ENABLED } from '@/lib/features';
import {
  filterChips,
  filterKey,
  loadArticles,
  loadSources,
  markAllRead,
  markReadingSeen,
  mergeArticles,
  READING_ABOUT,
  setRead,
  withRead,
  type Article,
  type ReadingFilter,
  unreadIn,
  withUnread,
  type Source,
} from '@/lib/reading';
import { useSession } from '@/lib/session';
import { showToast } from '@/lib/toast';
import { openArticle } from '@/lib/open-article';
import { useNow } from '@/lib/use-now';
import { usePalette } from '@/theme/use-palette';

/**
 * Feeds (2.0, from the drawer; "reading" in code): the newest articles from the sources I follow, timeline style. Chips filter by
 * All, Unread or one source; tapping an article marks it read and opens it in Circlo when the feed carries its text
 * (app/feeds/[id]), otherwise on its own site in the in-app browser.
 * No pushes and no counts; a "New articles" pill when more arrive while I'm here.
 */
export default function ReadingScreen() {
  const params = useLocalSearchParams<{ source?: string }>();
  const navigation = useNavigation();
  const palette = usePalette();
  const now = useNow();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const list = useRef<FlatList<Article>>(null);

  // The chip I picked, until Manage sources sends me back here with another source.
  const [chosen, setChosen] = useState<{ under?: string; filter: ReadingFilter } | null>(null);
  const filter = useMemo<ReadingFilter>(
    () => (chosen && chosen.under === params.source ? chosen.filter : params.source ? { kind: 'source', sourceId: params.source } : { kind: 'all' }),
    [chosen, params.source],
  );
  const setFilter = (f: ReadingFilter) => setChosen({ under: params.source, filter: f });
  const [sources, setSources] = useState<Source[] | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ articles: Article[]; next: string | null } | null>(null);
  const [pulling, setPulling] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [sheet, setSheet] = useState<{ title?: string; actions: SheetAction[] } | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, page] = await Promise.all([loadSources(), loadArticles(filter)]);
      setSources(s);
      setArticles(page.articles);
      setNext(page.next);
      setFresh(null);
      setError(undefined);
    } catch {
      setSources((s) => s ?? []);
      setError('Couldn’t load your feeds. Pull to try again.');
    }
  }, [filter]);

  // While I'm here, look for new articles every two minutes; they wait behind the pill instead of moving the list.
  const firstId = articles[0]?.articleId;
  const check = useCallback(async () => {
    try {
      const page = await loadArticles(filter);
      if (page.articles[0] && page.articles[0].articleId !== firstId) setFresh(page);
    } catch {
      // quiet: the next check or a pull tries again
    }
  }, [filter, firstId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      markReadingSeen().catch(() => undefined);
    }, [load]),
  );
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void check(), 120_000);
      return () => clearInterval(timer);
    }, [check]),
  );

  const pull = async () => {
    setPulling(true);
    await load();
    setPulling(false);
  };

  const more = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadArticles(filter, next);
      setArticles((a) => mergeArticles(a, page.articles));
      setNext(page.next);
    } catch {
      // the next scroll tries again
    } finally {
      setLoadingMore(false);
    }
  };

  const mark = (a: Article, read: boolean) => {
    setArticles((list) => withRead(list, a.articleId, read));
    setSources((s) => s && withUnread(s, a.sourceId, read ? -1 : 1));
    setRead(a.articleId, read).catch(() => {
      setArticles((list) => withRead(list, a.articleId, !read));
      setSources((s) => s && withUnread(s, a.sourceId, read ? 1 : -1));
    });
  };

  // With more to read than its summary, an article opens in Circlo (its own text, then a button to the site);
  // otherwise straight on its site.
  const open = (a: Article) => {
    if (!a.read) mark(a, true);
    if (a.hasContent) router.push({ pathname: '/feeds/[id]', params: { id: a.articleId } });
    else void openArticle(a.url, palette);
  };

  const articleMenu = (a: Article) =>
    setSheet({
      actions: [
        { label: a.read ? 'Mark as unread' : 'Mark as read', onPress: () => mark(a, !a.read) },
        ...(CHAT_ENABLED && account ? [{ label: 'Send in a chat', onPress: () => setSending(a.url) }] : []),
        {
          label: 'Copy link',
          onPress: async () => {
            await Clipboard.setStringAsync(a.url);
            showToast('Link copied');
          },
        },
        { label: 'Open in browser', onPress: () => void Linking.openURL(a.url) },
      ],
    });

  const source = filter.kind === 'source' ? sources?.find((s) => s.sourceId === filter.sourceId) : undefined;
  const readAll = useCallback(async () => {
    try {
      await markAllRead(filter.kind === 'source' ? filter.sourceId : undefined);
      setArticles((list) => list.map((a) => ({ ...a, read: true })));
      setSources((s) => s && withUnread(s, filter.kind === 'source' ? filter.sourceId : null, 'none'));
      if (filter.kind === 'unread') setArticles([]);
    } catch {
      showToast('Couldn’t mark them read. Try again.');
    }
  }, [filter]);

  // ⋯ only once there's something to manage, and "Mark all as read" only while something is unread.
  const following = (sources?.length ?? 0) > 0;
  const unread = sources ? unreadIn(sources, filter) : 0;
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View className="flex-row items-center pr-2">
          <IconButton accessibilityLabel="Add a source" onPress={() => router.push('/feeds/add')}>
            <Icon name="add" size={24} color={palette.ink} />
          </IconButton>
          {following ? (
            <IconButton
              accessibilityLabel="More"
              testID="header-more"
              onPress={() =>
                setSheet({
                  actions: [
                    ...(unread > 0
                      ? [{ label: source ? `Mark all from ${source.title} as read` : 'Mark all as read', onPress: () => void readAll() }]
                      : []),
                    { label: 'Manage sources', onPress: () => router.push('/feeds/sources') },
                  ],
                })
              }>
              <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
            </IconButton>
          ) : null}
        </View>
      ),
    });
  }, [navigation, palette.ink, readAll, source, following, unread]);

  if (sources === null) return <Spinner className="flex-1 bg-surface py-10 dark:bg-surface-dark" />;

  if (sources.length === 0) {
    return (
      <Screen>
        <EmptyState icon="rss-outline" title="Feeds" body={READING_ABOUT} actionLabel="Add a source" onAction={() => router.push('/feeds/add')} />
        {error ? <Text className="px-5 pb-6 text-center text-sm text-danger dark:text-danger-dark">{error}</Text> : null}
      </Screen>
    );
  }

  const chips = filterChips(sources);
  const empty =
    filter.kind === 'unread'
      ? { title: 'You’re all caught up', body: 'New articles from your sources will show here.' }
      : filter.kind === 'source'
        ? { title: 'Nothing here yet', body: `${source?.title ?? 'This source'}’s feed is empty for now. Circlo checks it every half hour.` }
        : { title: 'Nothing yet', body: 'New articles from your sources will show here. Circlo checks them every half hour.' };

  return (
    <Screen>
      <FlatList
        ref={list}
        data={articles}
        keyExtractor={(a) => a.articleId}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} />}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={
          <View className="bg-surface dark:bg-surface-dark">
            <ChipBar
              label="Show articles from"
              chips={chips}
              selected={filterKey(filter)}
              onSelect={(key) => {
                const chip = chips.find((c) => c.key === key);
                if (!chip) return;
                setFilter(chip.filter);
                list.current?.scrollToOffset({ offset: 0, animated: false });
              }}
            />
            {error ? <Text className="px-4 py-2 text-center text-sm text-danger dark:text-danger-dark">{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <View className="h-[480px]">
            <EmptyState icon="rss-outline" title={empty.title} body={empty.body} />
          </View>
        }
        ListFooterComponent={loadingMore ? <Spinner className="py-6" /> : undefined}
        onEndReached={() => void more()}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => <ArticleRow article={item} now={now} onOpen={() => open(item)} onMore={() => articleMenu(item)} />}
      />

      {fresh ? (
        <View pointerEvents="box-none" className="absolute left-0 right-0 top-14 items-center">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setArticles(fresh.articles);
              setNext(fresh.next);
              setFresh(null);
              list.current?.scrollToOffset({ offset: 0, animated: true });
            }}
            className="rounded-full bg-primary px-4 py-2 shadow-lg active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark">
            <Text className="font-bold text-on-primary dark:text-on-primary-dark">↑ New articles</Text>
          </Pressable>
        </View>
      ) : null}

      <ActionSheet title={sheet?.title} actions={sheet?.actions ?? null} onClose={() => setSheet(null)} />
      {account ? <SendToChatSheet account={account} text={sending} onClose={() => setSending(null)} /> : null}
    </Screen>
  );
}
