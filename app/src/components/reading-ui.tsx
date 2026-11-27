import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { API_URL } from '@/api/client';

import { avatarColor } from '@/components/avatar';
import { ContentText } from '@/components/content-text';
import { IconButton } from '@/components/icon-button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { imageUri, type Article } from '@/lib/reading';
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
      accessibilityHint={article.hasContent ? 'Opens the article' : 'Opens the article on its own site'}
      onPress={onOpen}
      onLongPress={onMore}
      className="flex-row gap-3 border-b border-border px-4 py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
      <SourceTile id={article.sourceId} title={article.sourceTitle} icon={article.sourceIcon} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-1">
          <Text numberOfLines={1} className="shrink text-[15px] text-muted dark:text-muted-dark">
            {article.sourceTitle} · {time}
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
      </View>
    </Pressable>
  );
}

/** A row of choice chips, the same look as the profile's circle chips. */
export function ChipBar({ chips, selected, onSelect, label }: {
  chips: { key: string; label: string }[];
  selected: string;
  onSelect: (key: string) => void;
  label: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={label} className="grow-0 border-b border-border dark:border-border-dark" contentContainerClassName="gap-2 px-4 py-2.5">
      {chips.map((c) => {
        const on = c.key === selected;
        return (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(c.key)}
            className={`flex-row items-center rounded-full border px-3.5 py-1.5 ${
              on
                ? 'border-primary bg-primary dark:border-primary-dark dark:bg-primary-dark'
                : 'border-border active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark'
            }`}>
            <Text numberOfLines={1} className={on ? 'max-w-[200px] font-semibold text-on-primary dark:text-on-primary-dark' : 'max-w-[200px] text-ink dark:text-ink-dark'}>
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
