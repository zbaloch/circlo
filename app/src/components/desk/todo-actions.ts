import { showAlert } from '@/lib/dialog';
import { dayText, dueLabel, type DeskTodo } from '@/lib/desk';
import { completeTodo, uncompleteTodo } from '@/lib/desk-api';
import { showToast } from '@/lib/toast';

/** What the toast says after ticking a to-do off: when a repeating one comes back. */
export function doneMessage(next: DeskTodo | null | undefined, today: string): string {
  if (!next?.dueDate) return 'Done';
  const label = dueLabel(next.dueDate, today);
  const when = !label ? '' : label.text === 'Tomorrow' ? 'tomorrow' : /^[A-Z][a-z]{2}$/.test(label.text) ? `on ${label.text}` : `on ${dayText(next.dueDate, today)}`;
  return `Done. It’s back ${when}`;
}

/**
 * Ticks a to-do off or back on, then calls `changed` so the screen reloads. Ticking off offers Undo in the toast, which
 * also takes back the next one a repeat made.
 */
export async function toggleTodo(todo: DeskTodo, today: string, changed: () => void): Promise<void> {
  try {
    if (todo.doneAt) {
      await uncompleteTodo(todo.id);
      changed();
      return;
    }
    const { next } = await completeTodo(todo.id, today);
    changed();
    showToast(doneMessage(next, today), {
      text: 'Undo',
      onPress: () => {
        uncompleteTodo(todo.id).then(changed, () => undefined);
      },
    });
  } catch {
    showAlert('Couldn’t update that to-do', 'Check your connection and try again.');
  }
}
