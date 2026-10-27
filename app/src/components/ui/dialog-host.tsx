import { Modal, Pressable, View } from 'react-native';

import { dismissDialog, orderedButtons, pressDialogButton, useDialog } from '@/lib/dialog';

import { Text } from './text';

/** Renders the current in-app dialog (lib/dialog.ts): centred card, stacked pill buttons, Cancel last. */
export function DialogHost() {
  const dialog = useDialog();
  return (
    <Modal visible={!!dialog} transparent animationType="fade" statusBarTranslucent onRequestClose={dismissDialog}>
      <Pressable accessibilityLabel="Close" className="flex-1 items-center justify-center bg-black/50 px-8" onPress={dismissDialog}>
        {dialog ? (
          // Inner Pressable swallows taps so tapping the card doesn't dismiss it.
          <Pressable accessibilityRole="alert" className="w-full max-w-[320px] gap-5 rounded-2xl bg-surface p-6 dark:bg-surface-dark">
            <View className="gap-2">
              <Text className="text-xl font-extrabold text-ink dark:text-ink-dark">{dialog.title}</Text>
              {dialog.message ? <Text className="text-[15px] leading-5 text-muted dark:text-muted-dark">{dialog.message}</Text> : null}
            </View>
            <View className="gap-3">
              {orderedButtons(dialog.buttons).map((b) => (
                <Pressable
                  key={b.text}
                  accessibilityRole="button"
                  onPress={() => pressDialogButton(b)}
                  className={
                    b.style === 'destructive'
                      ? 'items-center rounded-full bg-danger py-3 active:opacity-80 dark:bg-danger-dark'
                      : b.style === 'cancel'
                        ? 'items-center rounded-full border border-border py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark'
                        : 'items-center rounded-full bg-ink py-3 active:opacity-80 dark:bg-ink-dark'
                  }>
                  <Text
                    className={
                      b.style === 'cancel'
                        ? 'text-[15px] font-bold text-ink dark:text-ink-dark'
                        : b.style === 'destructive'
                          ? 'text-[15px] font-bold text-white'
                          : 'text-[15px] font-bold text-surface dark:text-surface-dark'
                    }>
                    {b.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}
