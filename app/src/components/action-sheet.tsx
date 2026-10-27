import { Modal, Pressable, Text, View } from 'react-native';

export type SheetAction = { label: string; destructive?: boolean; onPress: () => void };

/** A simple bottom sheet of actions (Android alerts allow only three buttons). */
export function ActionSheet({ title, actions, onClose }: { title?: string; actions: SheetAction[] | null; onClose: () => void }) {
  return (
    <Modal visible={!!actions} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="gap-1 rounded-t-3xl bg-surface pb-8 pt-3 dark:bg-surface-dark">
        <View className="items-center pb-2">
          <View className="h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
        </View>
        {title ? <Text className="px-5 pb-2 text-base font-bold text-ink dark:text-ink-dark">{title}</Text> : null}
        {(actions ?? []).map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              a.onPress();
            }}
            className="px-5 py-4 active:bg-surface-raised dark:active:bg-surface-raised-dark">
            <Text className={a.destructive ? 'text-base font-semibold text-danger dark:text-danger-dark' : 'text-base text-ink dark:text-ink-dark'}>{a.label}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={onClose} className="mx-5 mt-2 items-center rounded-full border border-border py-3 dark:border-border-dark">
          <Text className="text-base text-ink dark:text-ink-dark">Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
