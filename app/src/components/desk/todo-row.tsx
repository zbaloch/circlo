import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { dueLabel, repeatLabel, type DeskTodo } from '@/lib/desk';
import { usePalette } from '@/theme/use-palette';

/**
 * One to-do: a round tick box, its title, and a line with when it's due (red when late), how it repeats and, in
 * Today, which list it's in. Tapping the box ticks it off; tapping the rest opens it.
 */
export function TodoRow({ todo, today, showList = false, onToggle, onOpen }: {
  todo: DeskTodo;
  today: string;
  showList?: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const palette = usePalette();
  const done = !!todo.doneAt;
  const due = done ? null : dueLabel(todo.dueDate, today);
  return (
    <View className="flex-row items-start gap-3 px-4 py-3">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={todo.title}
        accessibilityState={{ checked: done }}
        hitSlop={10}
        onPress={onToggle}
        className="pt-0.5 active:opacity-60">
        <Icon name={done ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={done ? palette.primary : palette.muted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityHint="Opens the to-do" onPress={onOpen} className="flex-1 gap-0.5 active:opacity-60">
        <Text className={`text-[15px] ${done ? 'text-muted line-through dark:text-muted-dark' : 'text-ink dark:text-ink-dark'}`}>{todo.title}</Text>
        {due || todo.repeat || showList || todo.notes ? (
          <View className="flex-row flex-wrap items-center gap-x-2">
            {due ? (
              <Text className={`text-[13px] font-semibold ${due.late ? 'text-danger dark:text-danger-dark' : 'text-primary dark:text-primary-dark'}`}>{due.text}</Text>
            ) : null}
            {todo.repeat ? (
              <View className="flex-row items-center gap-1">
                <Icon name="repeat" size={12} color={palette.muted} />
                <Text className="text-[13px] text-muted dark:text-muted-dark">{repeatLabel(todo.repeat)}</Text>
              </View>
            ) : null}
            {showList ? <Text className="text-[13px] text-muted dark:text-muted-dark">{todo.listName}</Text> : null}
            {todo.notes ? <Icon name="document-outline" size={13} color={palette.muted} accessibilityLabel="Has notes" /> : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
