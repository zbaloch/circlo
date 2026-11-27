import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { API_URL } from '@/api/client';
import { singlePhotoShape } from '@/components/post-media';
import { Text } from '@/components/ui/text';
import { blockText, imageUri, type ContentBlock, type ContentRun } from '@/lib/reading';
import { textDirection, usesSystemFont } from '@/lib/script';

/**
 * An article from Feeds, drawn from the server's blocks with Circlo's own text styles (no web view: nothing from the
 * publisher runs). Each paragraph reads in its own direction, so Urdu or Arabic articles are right-aligned. Images are
 * signed Circlo links, so the publisher never sees who reads; links open on tap (`onLink`).
 */
export function ArticleContent({ blocks, onLink }: { blocks: ContentBlock[]; onLink: (url: string) => void }) {
  return (
    <View className="gap-4">
      {blocks.map((b, i) => (
        <Block key={i} block={b} onLink={onLink} />
      ))}
    </View>
  );
}

const BODY = 'text-[17px] leading-[26px] text-ink dark:text-ink-dark';

function Block({ block, onLink }: { block: ContentBlock; onLink: (url: string) => void }) {
  switch (block.type) {
    case 'h':
      return <Runs runs={block.runs} onLink={onLink} className="text-xl font-bold leading-7 text-ink dark:text-ink-dark" />;
    case 'quote':
      return (
        <View className="border-l-4 border-border pl-4 dark:border-border-dark">
          <Runs runs={block.runs} onLink={onLink} className="text-[17px] leading-[26px] text-muted dark:text-muted-dark" />
        </View>
      );
    case 'list':
      return (
        <View className="gap-2">
          {(block.items ?? []).map((item, i) => (
            <View key={i} className="flex-row gap-2 pr-2">
              <Text className={`${BODY} min-w-[20px]`}>{block.ordered ? `${i + 1}.` : '•'}</Text>
              <View className="flex-1">
                <Runs runs={item} onLink={onLink} className={BODY} />
              </View>
            </View>
          ))}
        </View>
      );
    case 'code':
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="rounded-xl bg-surface-raised dark:bg-surface-raised-dark" contentContainerClassName="p-3">
          <Text className="text-[14px] leading-5 text-ink dark:text-ink-dark">{block.text}</Text>
        </ScrollView>
      );
    case 'img':
      return block.src ? <ArticleImage src={block.src} alt={block.alt} w={block.w} h={block.h} /> : null;
    case 'hr':
      return <View className="mx-auto my-2 h-px w-1/3 bg-border dark:bg-border-dark" />;
    default:
      return <Runs runs={block.runs} onLink={onLink} className={BODY} />;
  }
}

/** A paragraph: its runs inside one Text, in the paragraph's own direction. */
function Runs({ runs, className, onLink }: { runs: ContentRun[] | undefined; className: string; onLink: (url: string) => void }) {
  const plain = blockText(runs);
  if (!plain) return null;
  const rtl = textDirection(plain) === 'rtl';
  return (
    <Text system={usesSystemFont(plain)} selectable className={`${className} ${rtl ? 'text-right' : ''}`}>
      {(runs ?? []).map((r, i) => (
        <Text
          key={i}
          system={usesSystemFont(plain)}
          accessibilityRole={r.href ? 'link' : undefined}
          onPress={r.href ? () => onLink(r.href!) : undefined}
          className={[
            r.b ? 'font-bold' : '',
            r.i ? 'italic' : '',
            r.code ? 'rounded bg-surface-raised dark:bg-surface-raised-dark' : '',
            r.href ? 'text-primary underline dark:text-primary-dark' : '',
          ].join(' ')}>
          {r.text}
        </Text>
      ))}
    </Text>
  );
}

/** An image through Circlo, full width in its own shape (snapped like a post's single photo), never cropped. */
function ArticleImage({ src, alt, w, h }: { src: string; alt?: string; w?: number; h?: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(w && h ? { w, h } : null);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // Tall ones (infographics, phone screenshots) stay square-framed so one picture doesn't fill the screen; nothing is cropped.
  const shape = singlePhotoShape(size?.w ?? 4, size?.h ?? 3);
  const frame = shape.tall ? 'aspect-square' : shape.className;
  return (
    <Image
      source={{ uri: imageUri(src, API_URL) }}
      accessibilityLabel={alt || 'Image'}
      accessibilityIgnoresInvertColors
      contentFit="contain"
      transition={150}
      onLoad={(e) => {
        if (!size && e.source.width > 0) setSize({ w: e.source.width, h: e.source.height });
      }}
      onError={() => setFailed(true)}
      className={`w-full rounded-2xl bg-surface-raised dark:bg-surface-raised-dark ${frame}`}
    />
  );
}
