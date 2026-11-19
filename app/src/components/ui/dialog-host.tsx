import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";

import {
  type Dialog,
  dismissDialog,
  orderedButtons,
  pressDialogButton,
  registerDialogHost,
  useDialog,
} from "@/lib/dialog";

import { Text } from "./text";

/**
 * Renders the current in-app dialog (lib/dialog.ts): centred card, stacked pill buttons, Cancel last. The app's root
 * host is its own Modal; `inline` draws over its parent instead, for use inside a bottom sheet's Modal.
 */
export function DialogHost({ inline = false }: { inline?: boolean }) {
  const [host] = useState(() => Symbol("dialog-host"));
  useEffect(() => registerDialogHost(host), [host]);
  const dialog = useDialog(host);
  if (inline) {
    return dialog ? (
      <View className="absolute inset-0">
        <DialogCard dialog={dialog} />
      </View>
    ) : null;
  }
  return (
    <Modal
      visible={!!dialog}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissDialog}
    >
      <DialogCard dialog={dialog} />
    </Modal>
  );
}

function DialogCard({ dialog }: { dialog: Dialog | null }) {
  return (
    <Pressable
      accessibilityLabel="Close"
      className="flex-1 items-center justify-center bg-black/50 px-8"
      onPress={dismissDialog}
    >
      {dialog ? (
        // Inner Pressable swallows taps so tapping the card doesn't dismiss it.
        <Pressable
          accessibilityRole="alert"
          className="w-full max-w-[320px] gap-5 rounded-2xl bg-surface p-6 dark:bg-surface-dark"
        >
          <View className="gap-2">
            <Text className="text-xl font-extrabold text-ink dark:text-ink-dark">
              {dialog.title}
            </Text>
            {dialog.message ? (
              <Text className="text-[15px] leading-5 text-muted dark:text-muted-dark">
                {dialog.message}
              </Text>
            ) : null}
          </View>
          <View className="gap-3">
            {orderedButtons(dialog.buttons).map((b) => (
              <Pressable
                key={b.text}
                accessibilityRole="button"
                onPress={() => pressDialogButton(b)}
                className={
                  b.style === "destructive"
                    ? "items-center rounded-full bg-danger py-3 active:opacity-80 dark:bg-danger-dark"
                    : b.style === "cancel"
                      ? "items-center rounded-full border border-border py-3 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark"
                      : "items-center rounded-full bg-ink py-3 active:opacity-80 dark:bg-ink-dark"
                }
              >
                <Text
                  className={
                    b.style === "cancel"
                      ? "text-[15px] font-bold text-ink dark:text-ink-dark"
                      : b.style === "destructive"
                        ? "text-[15px] font-bold text-white"
                        : "text-[15px] font-bold text-surface dark:text-surface-dark"
                  }
                >
                  {b.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      ) : null}
    </Pressable>
  );
}
