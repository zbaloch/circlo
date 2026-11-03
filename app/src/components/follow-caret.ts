import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ScrollViewInstance, TextInputSelectionChangeEvent } from 'react-native';

/** Typing at the end of the text (not editing somewhere earlier): the screen should follow the newest line. Pure. */
export function typingAtEnd(selectionEnd: number, textLength: number): boolean {
  return selectionEnd >= textLength;
}

/**
 * For a growing multiline field inside a ScrollView, with the toolbar and keyboard below it: as the field grows while
 * you type at the end, scroll so the line you're on stays in view instead of slipping under the toolbar or keyboard.
 * Editing earlier in the text leaves the scroll alone. Spread the result on the TextInput; `scroll` is the ScrollView's ref.
 */
export function useFollowCaret(scroll: RefObject<ScrollViewInstance | null>, text: string) {
  const length = useRef(text.length);
  useEffect(() => {
    length.current = text.length;
  }, [text]);
  const atEnd = useRef(true);
  const onSelectionChange = useCallback((e: TextInputSelectionChangeEvent) => {
    atEnd.current = typingAtEnd(e.nativeEvent.selection.end, length.current);
  }, []);
  const onContentSizeChange = useCallback(() => {
    if (atEnd.current) scroll.current?.scrollToEnd({ animated: true });
  }, [scroll]);
  return { onSelectionChange, onContentSizeChange };
}
