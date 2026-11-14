import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { FilesView } from '@/components/desk/files-view';
import { NotesSection } from '@/components/desk/notes-section';
import { TodosSection } from '@/components/desk/todos-section';
import { Screen } from '@/components/screen';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { DESK_ENABLED } from '@/lib/features';
import { usePalette } from '@/theme/use-palette';

type Section = 'todos' | 'notes' | 'files';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'todos', label: 'To-dos' },
  { key: 'notes', label: 'Notes' },
  { key: 'files', label: 'Files' },
];

/** Behind lib/features' DESK_ENABLED: when the Desk is switched off, a direct link lands on Home. */
export default function DeskScreenRoute() {
  return DESK_ENABLED ? <DeskScreen /> : <Redirect href="/" />;
}

/**
 * The Desk (owner decision 2026-11-14): a personal space for to-dos, notes and files, useful before you've connected
 * with anyone. Nothing in it is ever shared; only its owner can see it, and the server answers 404 to anyone else.
 */
export function DeskScreen() {
  const palette = usePalette();
  const [section, setSection] = useState<Section>('todos');
  return (
    <Screen>
      <View accessibilityRole="tablist" className="flex-row border-b border-border dark:border-border-dark">
        {SECTIONS.map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: section === t.key }}
            onPress={() => setSection(t.key)}
            className="flex-1 items-center pt-3 active:opacity-60">
            <Text className={section === t.key ? 'font-bold text-ink dark:text-ink-dark' : 'text-muted dark:text-muted-dark'}>{t.label}</Text>
            <View className={`mt-3 h-1 w-14 rounded-full ${section === t.key ? 'bg-primary dark:bg-primary-dark' : 'bg-transparent'}`} />
          </Pressable>
        ))}
      </View>
      <View className="flex-row items-center gap-2 px-4 py-2">
        <Icon name="lock-closed-outline" size={14} color={palette.muted} />
        <Text className="flex-1 text-[13px] text-muted dark:text-muted-dark">Only you can see your Desk. Nothing here is ever shared.</Text>
      </View>
      {section === 'todos' ? <TodosSection /> : section === 'notes' ? <NotesSection /> : <FilesView folderId={null} />}
    </Screen>
  );
}
