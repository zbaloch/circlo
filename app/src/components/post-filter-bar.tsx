import { Pressable, ScrollView } from 'react-native';

import { audienceIcon } from '@/components/audience-icon';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { AddressBook } from '@/lib/addressbook';
import { circleDefs } from '@/lib/circles';
import type { PostFilter } from '@/lib/posts';
import { usePalette } from '@/theme/use-palette';

export type FilterOption = { key: string; value: PostFilter | undefined; label: string; icon?: ReturnType<typeof audienceIcon> };

/** The choices on my own profile: All, Only me, Everyone, then my circles in id order. Pure. */
export function postFilterOptions(book: Pick<AddressBook, 'circleDefs'> | null): FilterOption[] {
  return [
    { key: 'all', value: undefined, label: 'All' },
    { key: 'onlyMe', value: 'onlyMe', label: 'Only me', icon: audienceIcon('onlyMe') },
    { key: 'everyone', value: 'everyone', label: 'Everyone', icon: audienceIcon('everyone') },
    ...(book ? circleDefs(book) : []).map((c) => ({ key: `c${c.id}`, value: c.id, label: c.name, icon: audienceIcon('circles') })),
  ];
}

/** The filter a choice's key stands for: undefined for All, `onlyMe`, `everyone`, or a circle id (`c6` → 6). Pure. */
export function filterValue(key: string): PostFilter | undefined {
  if (key === 'onlyMe' || key === 'everyone') return key;
  const id = /^c(\d+)$/.exec(key);
  return id ? Number(id[1]) : undefined;
}

/** What the list says when a filter has nothing in it. Pure. */
export function emptyFilterText(option: FilterOption | undefined, media: boolean): string | undefined {
  if (!option || option.value === undefined) return undefined;
  const what = media ? 'No photos or videos' : 'No posts';
  if (option.value === 'onlyMe') return `${what} just for you yet.`;
  if (option.value === 'everyone') return `${what} shared with Everyone yet.`;
  return `${what} shared with ${option.label} yet.`;
}

/**
 * On my own profile, shows only my posts shared with Only me, Everyone or one of my circles (owner request
 * 2026-11-20). Only I see it, as circle names are only ever shown to their owner.
 */
export function PostFilterBar({ options, selected, onSelect }: { options: FilterOption[]; selected: string; onSelect: (o: FilterOption) => void }) {
  const palette = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Show posts shared with" className="grow-0 border-b border-border dark:border-border-dark" contentContainerClassName="gap-2 px-4 py-2.5">
      {options.map((o) => {
        const on = o.key === selected;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.value === undefined ? 'All posts' : `Shared with ${o.label}`}
            onPress={() => onSelect(o)}
            className={`flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5 ${
              on
                ? 'border-primary bg-primary dark:border-primary-dark dark:bg-primary-dark'
                : 'border-border active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark'
            }`}>
            {o.icon ? <Icon name={o.icon} size={14} color={on ? palette.onPrimary : palette.muted} /> : null}
            <Text className={on ? 'font-semibold text-on-primary dark:text-on-primary-dark' : 'text-ink dark:text-ink-dark'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
