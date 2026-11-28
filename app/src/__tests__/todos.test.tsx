import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useSyncExternalStore, type ReactElement } from 'react';
import { View } from 'react-native';

import TodoScreen, { SAVE_AFTER_MS } from '@/app/todos/[id]';
import TodosScreen, { TICK_MS } from '@/app/todos/index';
import { addDays, todayIso, type Todo, type TodoFields, type TodoList } from '@/lib/todos';
import { clearTodos } from '@/lib/todos-store';

jest.setTimeout(20_000);

// Friday 27 November 2026, 10:00 on this phone.
const NOW = new Date(2026, 10, 27, 10, 0).getTime();
const TODAY = todayIso(new Date(NOW));
jest.mock('@/lib/use-now', () => ({ useNow: () => new Date(2026, 10, 27, 10, 0).getTime() }));

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
let mockHeaderRight: (() => ReactElement | null) | undefined;
const mockHeaderListeners = new Set<() => void>();
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({
    setOptions: (o: { headerRight?: () => ReactElement | null }) => {
      mockHeaderRight = o.headerRight;
      mockHeaderListeners.forEach((l) => l());
    },
  }),
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/api/client', () => ({ api: {}, ok: jest.fn(), API_URL: 'http://api.test' }));
jest.mock('@/components/keyboard-spacer', () => ({ KeyboardSpacer: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light' } }));
const mockToast = jest.fn();
jest.mock('@/lib/toast', () => ({ showToast: (m: string) => mockToast(m) }));
type Btn = { text: string; style?: string; onPress?: () => void };
const mockAlert = jest.fn((_t: string, _m?: string, buttons?: Btn[]) => buttons?.find((b) => b.style === 'destructive')?.onPress?.());
jest.mock('@/lib/dialog', () => ({ showAlert: (t: string, m?: string, b?: Btn[]) => mockAlert(t, m, b) }));
// The drag-to-reorder list needs Reanimated's native runtime: a plain list stands in.
jest.mock('react-native-reorderable-list', () => {
  const { FlatList } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: FlatList,
    reorderItems: <T,>(data: T[], from: number, to: number) => {
      const out = [...data];
      out.splice(to, 0, ...out.splice(from, 1));
      return out;
    },
    useReorderableDrag: () => jest.fn(),
  };
});

let mockLists: TodoList[] = [];
let mockTodos: Todo[] = [];
const mockAdd = jest.fn(async (f: TodoFields): Promise<Todo> => todo(`n${mockAdd.mock.calls.length}`, f.title, { ...f, listId: f.listId ?? 'g' }));
const mockSave = jest.fn(async (id: string, f: TodoFields): Promise<Todo> => todo(id, f.title, { ...f, listId: f.listId ?? 'g' }));
const mockComplete = jest.fn(async (_id: string, _today: string): Promise<{ completed: Todo; next: Todo | null }> => ({ completed: todo('x', 'x'), next: null }));
const mockReopen = jest.fn(async (id: string) => todo(id, 'Reopened'));
const mockCompleted = jest.fn(async (_listId: string | null): Promise<Todo[]> => []);
const mockAddList = jest.fn(async (name: string): Promise<TodoList> => ({ listId: 'new-list', name, general: false }));
const mockDelete = jest.fn(async (_id: string) => {});
const mockOrder = jest.fn(async (_listId: string, _ids: string[]) => {});
jest.mock('@/lib/todos', () => ({
  ...jest.requireActual('@/lib/todos'),
  loadTodos: async () => ({ lists: mockLists, todos: mockTodos }),
  addTodo: (f: TodoFields) => mockAdd(f),
  saveTodo: (id: string, f: TodoFields) => mockSave(id, f),
  completeTodo: (id: string, today: string) => mockComplete(id, today),
  reopenTodo: (id: string) => mockReopen(id),
  loadCompleted: (listId: string | null) => mockCompleted(listId),
  addList: (name: string) => mockAddList(name),
  deleteTodo: (id: string) => mockDelete(id),
  orderTodos: (listId: string, ids: string[]) => mockOrder(listId, ids),
}));

function todo(id: string, title: string, extra: Partial<Todo> = {}): Todo {
  return { todoId: id, listId: 'g', title, notes: null, dueDate: null, repeat: null, completedAt: null, createdAt: '2026-11-01T00:00:00Z', ...extra };
}

/** The screen with its header's buttons beside it, as the stack would draw them. */
function WithHeader({ children }: { children: ReactElement }) {
  const right = useSyncExternalStore(
    (onChange) => {
      mockHeaderListeners.add(onChange);
      return () => mockHeaderListeners.delete(onChange);
    },
    () => mockHeaderRight,
  );
  return (
    <>
      {children}
      <View testID="header">{right?.() ?? null}</View>
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  clearTodos();
  mockParams = {};
  mockHeaderRight = undefined;
  mockLists = [{ listId: 'g', name: 'General', general: true }, { listId: 'w', name: 'Work', general: false }];
  mockTodos = [];
});

describe('Todos', () => {
  it('starts on All: every open to-do under its list’s name, in my order; no counts anywhere', async () => {
    mockTodos = [
      todo('t1', 'Send invoice', { dueDate: TODAY }),
      todo('o1', 'Renew insurance', { dueDate: addDays(TODAY, -7), listId: 'w' }),
      todo('u1', 'Dentist', { dueDate: addDays(TODAY, 3) }),
      todo('n1', 'Learn Sindhi'),
    ];
    await render(<TodosScreen />);
    expect(await screen.findByText('Send invoice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Showing All' })).toBeTruthy();
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual(['General', 'Work']);
    expect(screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel)).toEqual(['Send invoice', 'Dentist', 'Learn Sindhi', 'Renew insurance']);
    expect(screen.getByText('20 Nov')).toBeTruthy();
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  it('Today, Upcoming and No date narrow All or one list; tapping again shows everything', async () => {
    mockTodos = [
      todo('t1', 'Send invoice', { dueDate: TODAY }),
      todo('o1', 'Renew insurance', { dueDate: addDays(TODAY, -7), listId: 'w' }),
      todo('u1', 'Dentist', { dueDate: addDays(TODAY, 1) }),
      todo('u2', 'Party', { dueDate: addDays(TODAY, 8) }),
      todo('n1', 'Learn Sindhi'),
      todo('w1', 'Quarterly report', { listId: 'w' }),
    ];
    await render(<TodosScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Today' }));
    expect(screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel)).toEqual(['Renew insurance', 'Send invoice']);
    // Under All, each shows its list.
    expect(screen.getByText('Work')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Upcoming' }));
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual(['Tomorrow', 'December']);
    await fireEvent.press(screen.getByRole('button', { name: 'No date' }));
    expect(screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel)).toEqual(['Learn Sindhi', 'Quarterly report']);

    // One list, with No date still picked; then Today with it.
    await fireEvent.press(screen.getByRole('button', { name: 'Showing All' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Work' }));
    expect(screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel)).toEqual(['Quarterly report']);
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel)).toEqual(['Renew insurance']);
    // Tapping Today again: all of Work, in my order.
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('button', { name: 'Today' }).props.accessibilityState).toEqual({ selected: false });
    expect(screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel)).toEqual(['Renew insurance', 'Quarterly report']);
  });

  it('quick add reads the date from my words, adds to what I’m looking at, and says when it lands elsewhere', async () => {
    await render(<TodosScreen />);
    const field = await screen.findByLabelText('New to-do');
    await fireEvent.changeText(field, 'Call mum tomorrow');
    expect(screen.getByText('Tomorrow')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add to-do' }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith({ title: 'Call mum', notes: null, dueDate: addDays(TODAY, 1), repeat: null, listId: null }));
    expect(mockToast).not.toHaveBeenCalled();

    // In Today with no date it's for today; tapping the chip away keeps "Monday" in the title.
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    await fireEvent.changeText(field, 'Read Monday notes');
    await fireEvent.press(screen.getByRole('button', { name: /Tap to keep the words “Monday”/ }));
    await fireEvent(field, 'submitEditing');
    await waitFor(() => expect(mockAdd).toHaveBeenLastCalledWith({ title: 'Read Monday notes', notes: null, dueDate: TODAY, repeat: null, listId: null }));
    expect(await screen.findByText('Read Monday notes')).toBeTruthy();

    // In Work + Today, a later date goes to Work and says when.
    await fireEvent.press(screen.getByRole('button', { name: 'Showing All' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Work' }));
    await fireEvent.changeText(screen.getByPlaceholderText('Add to Work'), 'Book flights next week');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to-do' }));
    await waitFor(() => expect(mockAdd).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Book flights', listId: 'w' })));
    expect(mockToast).toHaveBeenCalledWith('Added for Monday');
  });

  it('ticking checks it at once, and a moment later it’s done; tapping again in that moment undoes it', async () => {
    jest.useFakeTimers();
    try {
      mockTodos = [todo('t1', 'Send invoice', { dueDate: TODAY }), todo('t2', 'Water plants', { dueDate: TODAY, repeat: 'weekly' })];
      mockComplete.mockImplementation(async (id) => ({
        completed: todo(id, 'x'),
        next: id === 't2' ? todo('t3', 'Water plants', { dueDate: addDays(TODAY, 7), repeat: 'weekly' }) : null,
      }));
      await render(<TodosScreen />);
      await fireEvent.press(await screen.findByRole('button', { name: 'Today' }));
      await fireEvent.press(screen.getByRole('checkbox', { name: 'Send invoice' }));
      expect(screen.getByRole('checkbox', { name: 'Send invoice' }).props.accessibilityState).toEqual({ checked: true });
      await fireEvent.press(screen.getByRole('checkbox', { name: 'Send invoice' }));
      await act(async () => jest.advanceTimersByTime(TICK_MS + 100));
      expect(mockComplete).not.toHaveBeenCalled();
      expect(screen.getByRole('checkbox', { name: 'Send invoice' }).props.accessibilityState).toEqual({ checked: false });

      await fireEvent.press(screen.getByRole('checkbox', { name: 'Water plants' }));
      await act(async () => jest.advanceTimersByTime(TICK_MS + 100));
      expect(mockComplete).toHaveBeenCalledWith('t2', TODAY);
      // A repeating one comes back with its next date: next week, so not in Today, but in All.
      expect(screen.queryByText('Water plants')).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
      expect(screen.getByText('Water plants')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('lists: Completed in all or one list, to untick; General can’t be deleted; a new list from the picker', async () => {
    mockCompleted.mockResolvedValue([todo('c1', 'Old task', { completedAt: '2026-11-26T10:00:00Z', listId: 'w' })]);
    await render(
      <WithHeader>
        <TodosScreen />
      </WithHeader>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Completed' }));
    expect(await screen.findByText('Old task')).toBeTruthy();
    expect(mockCompleted).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Work')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Old task' }));
    await waitFor(() => expect(mockReopen).toHaveBeenCalledWith('c1'));

    expect(screen.queryByTestId('todos-more')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Showing All' }));
    await fireEvent.press(screen.getByRole('button', { name: 'General' }));
    await waitFor(() => expect(mockCompleted).toHaveBeenLastCalledWith('g'));
    await fireEvent.press(screen.getByTestId('todos-more'));
    expect(screen.getByRole('button', { name: 'Rename list' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete list' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Showing General' }));
    await fireEvent.press(screen.getByRole('button', { name: 'New list' }));
    await fireEvent.changeText(screen.getByLabelText('List name'), 'Groceries');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockAddList).toHaveBeenCalledWith('Groceries'));
    expect(await screen.findByRole('button', { name: 'Showing Groceries' })).toBeTruthy();
  });
});

describe('A to-do', () => {
  beforeEach(() => {
    mockParams = { id: 't1' };
    mockTodos = [todo('t1', 'File taxes', { notes: 'Forms in the blue folder https://gov.example', dueDate: TODAY })];
  });

  it('saves itself a moment after I change it: title, date in words, repeat and list', async () => {
    await render(<TodoScreen />);
    expect(await screen.findByDisplayValue('File taxes')).toBeTruthy();
    // Notes show with their links until I tap to edit them.
    expect(screen.getByRole('link', { name: 'https://gov.example' })).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Title'), 'File the taxes');
    await fireEvent.changeText(screen.getByLabelText('Type a date'), 'dec 5');
    expect(screen.getByText('5 Dec — press return to use it')).toBeTruthy();
    await fireEvent(screen.getByLabelText('Type a date'), 'submitEditing');
    await fireEvent.press(screen.getByRole('button', { name: 'Every month' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Work' }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenLastCalledWith('t1', {
        title: 'File the taxes',
        notes: 'Forms in the blue folder https://gov.example',
        dueDate: '2026-12-05',
        repeat: 'monthly',
        listId: 'w',
      }),
      { timeout: SAVE_AFTER_MS + 2000 },
    );
    expect(mockSave).toHaveBeenCalledTimes(1);

    // No date takes the repeat with it.
    await fireEvent.press(screen.getByRole('button', { name: 'No date' }));
    await waitFor(() => expect(mockSave).toHaveBeenLastCalledWith('t1', expect.objectContaining({ dueDate: null, repeat: null })), {
      timeout: SAVE_AFTER_MS + 2000,
    });
  });

  it('can be deleted', async () => {
    await render(
      <WithHeader>
        <TodoScreen />
      </WithHeader>,
    );
    await screen.findByDisplayValue('File taxes');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete to-do' }));
    expect(mockAlert).toHaveBeenCalledWith('Delete this to-do?', undefined, expect.anything());
    expect(mockBack).toHaveBeenCalled();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('t1'));
    expect(mockSave).not.toHaveBeenCalled();
  });
});
