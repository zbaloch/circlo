import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useSyncExternalStore, type ReactElement } from 'react';
import { View } from 'react-native';

import TodoScreen, { SAVE_AFTER_MS, TICK_BACK_MS } from '@/app/todos/[id]';
import TodosScreen, { TICK_MS } from '@/app/todos/index';
import type { Todo, TodoFields, TodoList, TodoNote } from '@/lib/todos';
import { clearTodos } from '@/lib/todos-store';

jest.setTimeout(20_000);

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
// The drag-to-reorder list needs Reanimated's native runtime: a plain list stands in, keeping its onReorder so a test
// can drop something; the swipeable row shows its Delete button without a swipe.
let mockReorder: ((e: { from: number; to: number }) => void) | undefined;
jest.mock('react-native-reorderable-list', () => {
  const { FlatList } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  return {
    __esModule: true,
    default: (props: { onReorder: (e: { from: number; to: number }) => void }) => {
      mockReorder = props.onReorder;
      return createElement(FlatList, props);
    },
    reorderItems: <T,>(data: T[], from: number, to: number) => {
      const out = [...data];
      out.splice(to, 0, ...out.splice(from, 1));
      return out;
    },
    useReorderableDrag: () => jest.fn(),
  };
});
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { createElement, Fragment } = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, renderRightActions }: { children: unknown; renderRightActions: (p: unknown, t: unknown, m: { close: () => void }) => unknown }) =>
      createElement(Fragment, null, children, renderRightActions(null, null, { close: () => undefined })),
  };
});

let mockLists: TodoList[] = [];
let mockTodos: Todo[] = [];
let mockNotes: TodoNote[] = [];
const mockAdd = jest.fn(async (f: TodoFields): Promise<Todo> => todo(`n${mockAdd.mock.calls.length}`, f.title, { listId: f.listId ?? 'g' }));
const mockSave = jest.fn(async (id: string, f: TodoFields): Promise<Todo> => todo(id, f.title, { listId: f.listId ?? 'g' }));
const mockComplete = jest.fn(async (id: string): Promise<Todo> => todo(id, 'x', { completedAt: '2026-11-28T10:00:00Z' }));
const mockReopen = jest.fn(async (id: string) => todo(id, 'Reopened'));
const mockCompleted = jest.fn(async (_listId: string | null): Promise<Todo[]> => []);
const mockAddList = jest.fn(async (name: string): Promise<TodoList> => ({ listId: 'new-list', name, general: false }));
const mockDelete = jest.fn(async (_id: string) => {});
const mockOrder = jest.fn(async (_listId: string, _ids: string[]) => {});
const mockAddNote = jest.fn(async (_id: string, body: string): Promise<TodoNote> => ({ noteId: 'note-new', body, createdAt: '2026-11-28T09:15:00Z' }));
const mockDeleteNote = jest.fn(async (_id: string, _noteId: string) => {});
jest.mock('@/lib/todos', () => ({
  ...jest.requireActual('@/lib/todos'),
  loadTodos: async () => ({ lists: mockLists, todos: mockTodos }),
  addTodo: (f: TodoFields) => mockAdd(f),
  saveTodo: (id: string, f: TodoFields) => mockSave(id, f),
  completeTodo: (id: string) => mockComplete(id),
  reopenTodo: (id: string) => mockReopen(id),
  loadCompleted: (listId: string | null) => mockCompleted(listId),
  addList: (name: string) => mockAddList(name),
  deleteTodo: (id: string) => mockDelete(id),
  orderTodos: (listId: string, ids: string[]) => mockOrder(listId, ids),
  loadNotes: async () => mockNotes,
  addNote: (id: string, body: string) => mockAddNote(id, body),
  deleteNote: (id: string, noteId: string) => mockDeleteNote(id, noteId),
}));

function todo(id: string, title: string, extra: Partial<Todo> = {}): Todo {
  return { todoId: id, listId: 'g', title, noteCount: 0, completedAt: null, createdAt: '2026-11-01T00:00:00Z', ...extra };
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

const titles = () => screen.getAllByRole('checkbox').map((c) => c.props.accessibilityLabel);

beforeEach(() => {
  jest.clearAllMocks();
  clearTodos();
  mockParams = {};
  mockHeaderRight = undefined;
  mockLists = [{ listId: 'g', name: 'General', general: true }, { listId: 'w', name: 'Work', general: false }];
  mockTodos = [];
  mockNotes = [];
});

describe('Todos', () => {
  it('starts on All: every open to-do under its list’s name, in my order; a mark when it has notes; no dates or counts', async () => {
    mockTodos = [todo('t1', 'Send invoice', { noteCount: 2 }), todo('t2', 'Learn Sindhi'), todo('w1', 'Quarterly report', { listId: 'w' })];
    await render(<TodosScreen />);
    expect(await screen.findByText('Send invoice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Showing All' })).toBeTruthy();
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual(['General', 'Work']);
    expect(titles()).toEqual(['Send invoice', 'Learn Sindhi', 'Quarterly report']);
    expect(screen.getByRole('button', { name: 'Send invoice, has notes' })).toBeTruthy();
    expect(screen.queryByText(/^\d+$/)).toBeNull();
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('one list from the picker; quick add adds to what I’m looking at', async () => {
    mockTodos = [todo('t1', 'Send invoice'), todo('w1', 'Quarterly report', { listId: 'w' })];
    await render(<TodosScreen />);
    const field = await screen.findByLabelText('New to-do');
    // Words stay words: "tomorrow" is part of the title.
    await fireEvent.changeText(field, 'Call mum tomorrow');
    await fireEvent(field, 'submitEditing');
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith({ title: 'Call mum tomorrow', listId: null }));
    expect(await screen.findByText('Call mum tomorrow')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Showing All' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Work' }));
    expect(titles()).toEqual(['Quarterly report']);
    await fireEvent.changeText(screen.getByPlaceholderText('Add to Work'), 'Book flights');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to-do' }));
    await waitFor(() => expect(mockAdd).toHaveBeenLastCalledWith({ title: 'Book flights', listId: 'w' }));
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('dragging in All reorders a list, or moves a to-do to the list it’s dropped under', async () => {
    mockTodos = [todo('t1', 'Send invoice'), todo('t2', 'Learn Sindhi'), todo('w1', 'Quarterly report', { listId: 'w' })];
    await render(<TodosScreen />);
    await screen.findByText('Send invoice');
    // [General] Send invoice, Learn Sindhi, [Work] Quarterly report: Learn Sindhi to the top of General.
    await act(async () => mockReorder?.({ from: 2, to: 1 }));
    await waitFor(() => expect(mockOrder).toHaveBeenCalledWith('g', ['t2', 't1']));
    expect(mockSave).not.toHaveBeenCalled();
    expect(titles()).toEqual(['Learn Sindhi', 'Send invoice', 'Quarterly report']);
    // Send invoice dropped after Quarterly report: into Work, at its end.
    await act(async () => mockReorder?.({ from: 2, to: 4 }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('t1', { title: 'Send invoice', listId: 'w' }));
    await waitFor(() => expect(mockOrder).toHaveBeenLastCalledWith('w', ['w1', 't1']));
  });

  it('swiping a to-do left shows Delete; one with notes asks first', async () => {
    mockTodos = [todo('t1', 'Send invoice'), todo('t2', 'Plan the trip', { noteCount: 3 })];
    await render(<TodosScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete Send invoice' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('t1'));
    expect(mockAlert).not.toHaveBeenCalled();
    expect(screen.queryByText('Send invoice')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete Plan the trip' }));
    expect(mockAlert).toHaveBeenCalledWith('Delete “Plan the trip”?', 'Its notes are deleted with it.', expect.anything());
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('t2'));
  });

  it('ticking checks it at once, and a moment later it’s done; tapping again in that moment undoes it', async () => {
    jest.useFakeTimers();
    try {
      mockTodos = [todo('t1', 'Send invoice'), todo('t2', 'Water plants')];
      await render(<TodosScreen />);
      await fireEvent.press(await screen.findByRole('checkbox', { name: 'Send invoice' }));
      expect(screen.getByRole('checkbox', { name: 'Send invoice' }).props.accessibilityState).toEqual({ checked: true });
      await fireEvent.press(screen.getByRole('checkbox', { name: 'Send invoice' }));
      await act(async () => jest.advanceTimersByTime(TICK_MS + 100));
      expect(mockComplete).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByRole('checkbox', { name: 'Water plants' }));
      await act(async () => jest.advanceTimersByTime(TICK_MS + 100));
      expect(mockComplete).toHaveBeenCalledWith('t2');
      expect(screen.queryByText('Water plants')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('Completed, in all or one list, to untick; General can’t be deleted; a new list from the picker', async () => {
    mockCompleted.mockResolvedValue([todo('c1', 'Old task', { completedAt: '2026-11-26T10:00:00Z', listId: 'w' })]);
    await render(
      <WithHeader>
        <TodosScreen />
      </WithHeader>,
    );
    await fireEvent.press(await screen.findByRole('switch', { name: 'Completed' }));
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
    mockTodos = [todo('t1', 'Plan the trip', { noteCount: 1 })];
    mockNotes = [{ noteId: 'n1', body: 'Flights look cheaper on Tuesdays https://air.example', createdAt: '2026-11-27T14:05:00Z' }];
  });

  it('shows its notes in order, without their times, and adds the next one at the bottom', async () => {
    await render(<TodoScreen />);
    expect(await screen.findByText(/Flights look cheaper on Tuesdays/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'https://air.example' })).toBeTruthy();
    expect(screen.queryByText(/Nov 2026/)).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('New note'), '  Booked the 9am  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(mockAddNote).toHaveBeenCalledWith('t1', 'Booked the 9am'));
    expect(await screen.findByText('Booked the 9am')).toBeTruthy();
    expect(screen.queryByText(/Nov 2026/)).toBeNull();
    expect(screen.getByLabelText('New note').props.value).toBe('');
  });

  it('a long press deletes a note', async () => {
    await render(<TodoScreen />);
    await fireEvent(await screen.findByText(/Flights look cheaper/), 'longPress');
    expect(mockAlert).toHaveBeenCalledWith('Delete this note?', undefined, expect.anything());
    await waitFor(() => expect(mockDeleteNote).toHaveBeenCalledWith('t1', 'n1'));
    expect(screen.queryByText(/Flights look cheaper/)).toBeNull();
    expect(screen.getByText(/No notes yet/)).toBeTruthy();
  });

  it('saves its title and list a moment after I change them', async () => {
    await render(<TodoScreen />);
    await fireEvent.changeText(await screen.findByLabelText('Title'), 'Plan the summer trip');
    await fireEvent.press(screen.getByRole('button', { name: 'Work' }));
    await waitFor(() => expect(mockSave).toHaveBeenLastCalledWith('t1', { title: 'Plan the summer trip', listId: 'w' }), { timeout: SAVE_AFTER_MS + 2000 });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('can be ticked off from its own screen, then goes back to the list', async () => {
    jest.useFakeTimers();
    try {
      await render(<TodoScreen />);
      await fireEvent.press(await screen.findByRole('checkbox', { name: 'Done' }));
      expect(screen.getByRole('checkbox', { name: 'Done' }).props.accessibilityState).toEqual({ checked: true });
      expect(mockComplete).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTime(TICK_BACK_MS + 50));
      expect(mockBack).toHaveBeenCalled();
      expect(mockComplete).toHaveBeenCalledWith('t1');
    } finally {
      jest.useRealTimers();
    }
  });

  it('can be deleted, notes and all', async () => {
    await render(
      <WithHeader>
        <TodoScreen />
      </WithHeader>,
    );
    await screen.findByDisplayValue('Plan the trip');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete to-do' }));
    expect(mockAlert).toHaveBeenCalledWith('Delete this to-do?', 'Its notes are deleted with it.', expect.anything());
    expect(mockBack).toHaveBeenCalled();
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('t1'));
    expect(mockSave).not.toHaveBeenCalled();
  });
});
