import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

/** Scrollable, keyboard-aware container for onboarding forms. */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="grow gap-5 px-6 pb-10 pt-4">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
