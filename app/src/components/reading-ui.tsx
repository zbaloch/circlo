import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { API_URL } from '@/api/client';

import { avatarColor } from '@/components/avatar';
import { ContentText } from '@/components/content-text';
import { IconButton } from '@/components/icon-button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { lengthLabel } from '@/lib/podcast-player';
import { imageUri, isVideo, type Article, type Source } from '@/lib/reading';
import { relativeTime } from '@/lib/time';
import { usePalette } from '@/theme/use-palette';

const TILE = { md: 'h-10 w-10 rounded-lg', lg: 'h-12 w-12 rounded-xl' };

/**
 * A source's tile: its logo when Circlo found one (the feed's own, else its site's icon), fetched through Circlo so
 * the site never sees who's reading; otherwise its initial, coloured from the source id as a person's is from theirs.
 * Square-ish, so sources don't look like people. Logos sit on white, as most are drawn for a light page.
 */
export function SourceTile({ id, title, icon, size = 'md' }: { id: string; title: string; icon?: string | null; size?: keyof typeof TILE }) {
  const [failed, setFailed] = useState<string | null>(null);
  const color = avatarColor(id);
  const initial = [...title.trim()][0]?.toUpperCase() ?? '?';
  if (icon && failed !== icon) {
    return (
      <View className={`overflow-hidden border border-border bg-white dark:border-border-dark ${TILE[size]}`}>
        <Image
          testID="source-logo"
          source={{ uri: imageUri(icon, API_URL) }}
          accessibilityIgnoresInvertColors
          contentFit="contain"
          onError={() => setFailed(icon)}
          className="h-full w-full"
        />
      </View>
    );
  }
  return (
    <View className={`items-center justify-center ${TILE[size]} ${color.bg}`}>
      <Text className={`font-bold ${color.text} ${size === 'lg' ? 'text-xl' : 'text-base'}`}>{initial}</Text>
    </View>
  );
}

/**
 * A video's thumbnail (through Circlo), 16:9 with a play mark, so YouTube videos look like videos. Gone if it fails.
 */
export function VideoThumbnail({ src }: { src: string }) {
  const palette = usePalette();
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <View className="mt-2 overflow-hidden rounded-2xl border border-border dark:border-border-dark">
      <Image
        testID="video-thumbnail"
        source={{ uri: imageUri(src, API_URL) }}
        accessibilityIgnoresInvertColors
        contentFit="cover"
        onError={() => setFailed(true)}
        className="aspect-video w-full bg-surface-raised dark:bg-surface-raised-dark"
      />
      <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-primary/90 dark:bg-primary-dark/90">
          <Icon name="play" size={22} color={palette.onPrimary} />
        </View>
      </View>
    </View>
  );
}

/**
 * One article, timeline style: tile, source · time, the title (bold while unread) and two lines of summary. Tapping
 * opens it on its own site; ⋯ (or a long press) has the rest.
 */
export function ArticleRow({ article, now, onOpen, onMore }: { article: Article; now: number; onOpen: () => void; onMore: () => void }) {
  const palette = usePalette();
  const time = relativeTime(Date.parse(article.publishedAt), now);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${article.title}, ${article.sourceTitle}, ${time}${article.read ? '' : ', unread'}`}
      accessibilityHint={
        article.audio ? 'Opens the episode' : article.hasContent ? 'Opens the article' : isVideo(article.url) ? 'Opens the video on YouTube' : 'Opens the article on its own site'
      }
      onPress={onOpen}
      onLongPress={onMore}
      className="flex-row gap-3 border-b border-border px-4 py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
      <SourceTile id={article.sourceId} title={article.sourceTitle} icon={article.sourceIcon} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-1">
          <Text numberOfLines={1} className="shrink text-[15px] text-muted dark:text-muted-dark">
            {article.sourceTitle} · {time}
            {article.audio?.durationSeconds ? ` · ${lengthLabel(article.audio.durationSeconds)}` : ''}
          </Text>
          <View className="flex-1" />
          <IconButton accessibilityLabel="More" onPress={onMore} className="-my-2 -mr-2">
            <Icon name="ellipsis-horizontal" size={18} color={palette.muted} />
          </IconButton>
        </View>
        <ContentText
          text={article.title}
          links={false}
          numberOfLines={2}
          className={article.read ? 'text-[16px] leading-snug text-muted dark:text-muted-dark' : 'text-[16px] font-bold leading-snug text-ink dark:text-ink-dark'}
        />
        {article.summary ? (
          <ContentText text={article.summary} links={false} numberOfLines={2} className="text-[15px] leading-snug text-muted dark:text-muted-dark" />
        ) : null}
        {article.image && !article.audio && isVideo(article.url) ? <VideoThumbnail src={article.image} /> : null}
      </View>
    </Pressable>
  );
}

const CHIP = 'flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5';
const CHIP_ON = 'border-primary bg-primary dark:border-primary-dark dark:bg-primary-dark';
const CHIP_OFF = 'border-border active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark';

/**
 * What Feeds shows: which source (All, or one, picked from a list) and an Unread toggle, which work together
 * ("Veritasium, unread only").
 */
export function FilterBar({ sourceLabel, unread, onPickSource, onToggleUnread }: {
  sourceLabel: string;
  unread: boolean;
  onPickSource: () => void;
  onToggleUnread: () => void;
}) {
  const palette = usePalette();
  return (
    <View className="flex-row items-center gap-2 border-b border-border px-4 py-2.5 dark:border-border-dark">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Showing ${sourceLabel}`}
        accessibilityHint="Choose which source to show"
        onPress={onPickSource}
        className={`shrink ${CHIP} ${CHIP_OFF}`}>
        <Text numberOfLines={1} className="shrink font-semibold text-ink dark:text-ink-dark">
          {sourceLabel}
        </Text>
        <Icon name="chevron-down" size={16} color={palette.ink} />
      </Pressable>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Unread only"
        accessibilityState={{ checked: unread }}
        onPress={onToggleUnread}
        className={`${CHIP} ${unread ? CHIP_ON : CHIP_OFF}`}>
        <Text className={unread ? 'font-semibold text-on-primary dark:text-on-primary-dark' : 'text-ink dark:text-ink-dark'}>Unread</Text>
      </Pressable>
    </View>
  );
}

/**
 * The list of sources to show articles from, with All first: each with its logo and how many are unread, and
 * a check on the one shown. Scrolls, as people can follow up to 200.
 */
export function SourcePicker({ visible, sources, selected, onSelect, onClose }: {
  visible: boolean;
  sources: Pick<Source, 'sourceId' | 'title' | 'icon' | 'unread'>[];
  selected: string | null;
  onSelect: (sourceId: string | null) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const total = sources.reduce((n, s) => n + s.unread, 0);
  const row = (key: string, id: string | null, title: string, unread: number, tile: ReactNode) => {
    const on = selected === id;
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={`${title}${unread > 0 ? `, ${unread} unread` : ''}`}
        accessibilityState={{ selected: on }}
        onPress={() => {
          onClose();
          onSelect(id);
        }}
        className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
        {tile}
        <Text numberOfLines={1} className={`flex-1 text-base ${on ? 'font-bold' : ''} text-ink dark:text-ink-dark`}>
          {title}
        </Text>
        {unread > 0 ? <Text className="text-sm tabular-nums text-muted dark:text-muted-dark">{unread}</Text> : null}
        <View className="w-6 items-end">{on ? <Icon name="checkmark" size={20} color={palette.ink} /> : null}</View>
      </Pressable>
    );
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[75%] rounded-t-3xl bg-surface pb-8 pt-3 dark:bg-surface-dark">
        <View className="items-center pb-2">
          <View className="h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
        </View>
        <Text className="px-5 pb-2 text-base font-bold text-ink dark:text-ink-dark">Show articles from</Text>
        <ScrollView>
          {row(
            'all',
            null,
            'All',
            total,
            <View className={`items-center justify-center bg-surface-raised dark:bg-surface-raised-dark ${TILE.md}`}>
              <Icon name="rss-outline" size={20} color={palette.ink} />
            </View>,
          )}
          {sources.map((s) => row(s.sourceId, s.sourceId, s.title, s.unread, <SourceTile id={s.sourceId} title={s.title} icon={s.icon} />))}
        </ScrollView>
      </View>
    </Modal>
  );
}
