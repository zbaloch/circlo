import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { ArticleContent } from '@/components/article-content';
import { ContentText } from '@/components/content-text';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/form';
import { IconButton } from '@/components/icon-button';
import { SourceTile } from '@/components/reading-ui';
import { SendToChatSheet } from '@/components/send-to-chat-sheet';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { CHAT_ENABLED } from '@/lib/features';
import { openArticle } from '@/lib/open-article';
import { loadArticle, openOnSiteLabel, setRead, type ArticleDetail } from '@/lib/reading';
import { useSession } from '@/lib/session';
import { fullTime } from '@/lib/time';
import { showToast } from '@/lib/toast';
import { usePalette } from '@/theme/use-palette';

/**
 * An article from Feeds, read in Circlo (owner decision 2026-11-27): the feed's own text and pictures, then a button to
 * the original on its site. Pictures come through Circlo, so the publisher only sees someone who taps through.
 */
export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const palette = usePalette();
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [sheet, setSheet] = useState<SheetAction[] | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    loadArticle(id).then(
      (d) => {
        setDetail(d);
        // Opening it reads it.
        if (!d.article.read) setRead(d.article.articleId, true).catch(() => undefined);
      },
      () => setMissing(true),
    );
  }, [id]);

  const open = useCallback((url: string) => void openArticle(url, palette), [palette]);
  const article = detail?.article;

  useEffect(() => {
    if (!article) return;
    navigation.setOptions({
      title: article.sourceTitle,
      headerRight: () => (
        <IconButton
          accessibilityLabel="More"
          className="mr-2"
          onPress={() =>
            setSheet([
              {
                label: 'Mark as unread',
                onPress: () => {
                  setRead(article.articleId, false).then(() => showToast('Marked as unread'), () => showToast('Couldn’t change it. Try again.'));
                },
              },
              ...(CHAT_ENABLED && account ? [{ label: 'Send in a chat', onPress: () => setSending(article.url) }] : []),
              {
                label: 'Copy link',
                onPress: async () => {
                  await Clipboard.setStringAsync(article.url);
                  showToast('Link copied');
                },
              },
              { label: 'Open in browser', onPress: () => void Linking.openURL(article.url) },
            ])
          }>
          <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
        </IconButton>
      ),
    });
  }, [navigation, article, palette.ink, account]);

  if (missing) {
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark">
        <EmptyState icon="rss-outline" title="Not here any more" body="This article is no longer in your feeds. Articles are kept for 60 days." />
      </View>
    );
  }
  if (!detail || !article) return <Spinner className="flex-1 bg-surface py-10 dark:bg-surface-dark" />;

  const label = openOnSiteLabel(article.url);
  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView contentContainerClassName="gap-5 px-5 pb-12 pt-4">
        <View className="flex-row items-center gap-3">
          <SourceTile id={article.sourceId} title={article.sourceTitle} />
          <View className="flex-1">
            <Text numberOfLines={1} className="text-[15px] font-semibold text-ink dark:text-ink-dark">
              {article.sourceTitle}
            </Text>
            <Text numberOfLines={1} className="text-[15px] text-muted dark:text-muted-dark">
              {article.author ? `${article.author} · ` : ''}
              {fullTime(Date.parse(article.publishedAt))}
            </Text>
          </View>
        </View>
        <ContentText text={article.title} links={false} className="text-2xl font-extrabold leading-8 text-ink dark:text-ink-dark" />
        {detail.content.length > 0 ? (
          <ArticleContent blocks={detail.content} onLink={open} />
        ) : article.summary ? (
          <ContentText text={article.summary} links={false} className="text-[17px] leading-[26px] text-ink dark:text-ink-dark" />
        ) : null}
        <View className="gap-2 pt-2">
          <Button label={`${label} ↗`} onPress={() => open(article.url)} />
          <Text className="text-center text-sm text-muted dark:text-muted-dark">Opens on its own site, where its usual cookies and ads apply.</Text>
        </View>
      </ScrollView>
      <ActionSheet actions={sheet} onClose={() => setSheet(null)} />
      {account ? <SendToChatSheet account={account} text={sending} onClose={() => setSending(null)} /> : null}
    </View>
  );
}
