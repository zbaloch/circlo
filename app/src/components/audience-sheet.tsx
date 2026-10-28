import { Icon } from '@/components/ui/icon';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { AudienceBadge, CircleBadge } from './circle-badge';
import { Button } from '@/components/form';
import type { AddressBook, Audience } from '@/lib/addressbook';
import { audienceSize, circleDefs, membersOf, ONLY_ME, TO_EVERYONE } from '@/lib/circles';
import { usePalette } from '@/theme/use-palette';
import { Text } from '@/components/ui/text';

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

export function audienceLine(book: AddressBook, audience: Audience): string {
  if (audience.kind === 'onlyMe') return 'Only you';
  if (audience.kind === 'everyone') return `All your friends · ${people(audienceSize(book, audience))}`;
  return `Only people in ${audience.ids.length === 1 ? 'this circle' : 'these circles'} · ${people(audienceSize(book, audience))}`;
}

/** The sheet's frame: a dimmed backdrop and a rounded bottom panel. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[80%] rounded-t-3xl bg-surface pb-6 dark:bg-surface-dark">
        <View className="items-center py-3">
          <View className="h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
        </View>
        <Text className="px-5 pb-2 text-xl font-bold text-ink dark:text-ink-dark">{title}</Text>
        {children}
      </View>
    </Modal>
  );
}

/** One tappable row: a badge, a title, a line under it, and a radio or checkbox mark. */
export function ChoiceRow({ badge, title, line, checked, multi = false, onPress }: {
  badge: React.ReactNode;
  title: string;
  line: string;
  checked: boolean;
  multi?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked } : { selected: checked }}
      onPress={onPress}
      className="flex-row items-center gap-3 px-5 py-3 active:bg-surface-raised dark:active:bg-surface-raised-dark">
      {badge}
      <View className="flex-1">
        <Text className="text-base font-semibold text-ink dark:text-ink-dark">{title}</Text>
        <Text className="text-sm text-muted dark:text-muted-dark">{line}</Text>
      </View>
      {multi ? (
        <Icon name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? palette.primary : palette.muted} />
      ) : checked ? (
        <Icon name="checkmark-circle" size={22} color={palette.primary} />
      ) : null}
    </Pressable>
  );
}

/**
 * Who can see a post (PLAN.md 2A): Only me, Everyone, or any of my circles together. Author-only: readers never see
 * any of this, and the server can't tell one audience from another.
 */
export function AudienceSheet(props: {
  visible: boolean;
  book: AddressBook;
  selected: Audience;
  onSelect: (audience: Audience) => void;
  onClose: () => void;
}) {
  // The body mounts each time the sheet opens, so its circle choice starts from the current audience.
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title="Who can see this?">
      <AudienceChoices {...props} />
    </Sheet>
  );
}

function AudienceChoices({ book, selected, onSelect, onClose }: {
  book: AddressBook;
  selected: Audience;
  onSelect: (audience: Audience) => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState<number[]>(selected.kind === 'circles' ? selected.ids : []);
  const pick = (a: Audience) => {
    onSelect(a);
    onClose();
  };
  const toggle = (id: number) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].sort((a, b) => a - b)));
  const circles = circleDefs(book);
  return (
    <>
      <ScrollView>
        <ChoiceRow
          badge={<AudienceBadge book={book} audience={ONLY_ME} />}
          title="Only me"
          line="Only you"
          checked={selected.kind === 'onlyMe' && ids.length === 0}
          onPress={() => pick(ONLY_ME)}
        />
        <ChoiceRow
          badge={<AudienceBadge book={book} audience={TO_EVERYONE} />}
          title="Everyone"
          line={audienceLine(book, TO_EVERYONE)}
          checked={selected.kind === 'everyone' && ids.length === 0}
          onPress={() => pick(TO_EVERYONE)}
        />
        {circles.length ? (
          <Text className="px-5 pb-1 pt-4 text-xs font-semibold uppercase text-muted dark:text-muted-dark">
            Circles · pick one or more
          </Text>
        ) : null}
        {circles.map((c) => (
          <ChoiceRow
            key={c.id}
            multi
            badge={<CircleBadge book={book} id={c.id} />}
            title={c.name}
            line={people(membersOf(book, c.id).length)}
            checked={ids.includes(c.id)}
            onPress={() => toggle(c.id)}
          />
        ))}
      </ScrollView>
      {ids.length ? (
        <View className="px-5 pt-3">
          <Button label={`Share with ${people(audienceSize(book, { kind: 'circles', ids }))}`} onPress={() => pick({ kind: 'circles', ids })} />
        </View>
      ) : null}
    </>
  );
}
