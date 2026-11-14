import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DeskScreen } from '@/app/(drawer)/(tabs)/desk';
import BoardScreen from '@/app/desk/board/[id]';
import BoardFormScreen from '@/app/desk/board-form';
import FileScreen from '@/app/desk/file/[id]';
import NoteScreen from '@/app/desk/note/[id]';
import TodoScreen from '@/app/desk/todo/[id]';
import { localDate } from '@/lib/desk';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: jest.fn(), canGoBack: () => true, replace: (p: unknown) => mockReplace(p) },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/api/client', () => ({}));
// The keyboard spacer runs on Reanimated's native runtime, which doesn't load under jest.
jest.mock('@/components/keyboard-spacer', () => ({ KeyboardSpacer: () => null }));
jest.mock('@/lib/desk-upload', () => ({ addFromLibrary: jest.fn(), addDocuments: jest.fn() }));
const mockOpenLink = jest.fn();
jest.mock('@/lib/links', () => ({ openLink: (u: string) => mockOpenLink(u) }));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));
jest.mock('@/lib/dialog', () => ({ showAlert: jest.fn() }));

const today = localDate();
const todo = (id: string, title: string, extra: object = {}) => ({
  id, boardId: 'b1', boardName: 'Home', title, description: '', dueDate: null, repeat: null, doneAt: null, commentCount: 0,
  createdAt: '2026-11-14T08:00:00Z', ...extra,
});
const comment = (id: string, body: string) => ({ id, body, createdAt: '2026-11-12T00:00:00Z' });
const pdf = {
  id: 'x1', boardId: 'b1', boardName: 'Home', title: 'Boarding pass', description: 'Seat 14A', fileName: 'Boarding pass.pdf', mime: 'application/pdf',
  kind: 'file', sizeBytes: 120_000, width: 0, height: 0, durationMs: 0, objectKey: 'a'.repeat(64), url: 'https://files.example/a', previewKey: null,
  previewUrl: null, commentCount: 1, createdAt: '2026-11-14T00:00:00Z',
};
const note = {
  id: 'n1', boardId: 'b1', boardName: 'Home', title: 'Hotel options', description: 'Three places near the beach.', pinned: false, commentCount: 1,
  createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z',
};

const mockApi = {
  fetchToday: jest.fn(async () => [todo('t1', 'Pay electricity bill', { dueDate: today, repeat: { kind: 'monthly', every: 1 }, boardName: 'Bills' })]),
  fetchBoards: jest.fn(async () => [
    { id: 'b1', name: 'Home', description: 'Everything about the flat', todos: 3, notes: 2, files: 1, createdAt: '2026-11-01T00:00:00Z' },
    { id: 'b2', name: 'Bills', description: '', todos: 1, notes: 0, files: 0, createdAt: '2026-11-01T00:00:00Z' },
  ]),
  fetchBoard: jest.fn(async () => ({ id: 'b1', name: 'Home', description: 'Everything about the flat', todos: 1, notes: 1, files: 1, createdAt: '2026-11-01T00:00:00Z' })),
  createBoard: jest.fn(async (b: { name: string }) => ({ id: 'b5', name: b.name, description: '', todos: 0, notes: 0, files: 0, createdAt: '2026-11-15T00:00:00Z' })),
  updateBoard: jest.fn(async () => ({})),
  completeTodo: jest.fn(async (id: string) => ({ todo: todo(id, 'x', { doneAt: '2026-11-14T09:00:00Z' }), next: todo('t9', 'x', { dueDate: '2026-12-14' }) })),
  uncompleteTodo: jest.fn(async () => todo('t1', 'x')),
  fetchBoardTodos: jest.fn(async () => ({ open: [todo('t2', 'Fix the tap', { commentCount: 2 })], done: [todo('t3', 'Clean gutters', { doneAt: '2026-11-12T00:00:00Z' })] })),
  fetchBoardNotes: jest.fn(async () => [
    { id: 'n1', boardId: 'b1', title: 'Hotel options', snippet: 'Three places near the beach', pinned: true, commentCount: 2, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' },
  ]),
  fetchBoardFiles: jest.fn(async () => [pdf]),
  createTodo: jest.fn(async (input: { title: string }) => todo('t4', input.title)),
  fetchTodo: jest.fn(async () => ({ todo: todo('t2', 'Fix the tap'), history: [], comments: [comment('c1', 'Washer is 1/2 inch')] })),
  updateTodo: jest.fn(async (_id: string, input: object) => ({ ...todo('t2', 'Fix the tap'), ...input })),
  fetchNote: jest.fn(async () => ({ note, comments: [comment('c2', 'Called, the second one is full')] })),
  createNote: jest.fn(async () => ({ ...note, id: 'n7' })),
  updateNote: jest.fn(),
  fetchFile: jest.fn(async () => ({ file: pdf, comments: [comment('c3', 'Gate 22')] })),
  updateFile: jest.fn(async (_id: string, change: object) => ({ ...pdf, ...change })),
  addComment: jest.fn(async (_on: string, _id: string, body: string) => comment('c9', body)),
};
jest.mock('@/lib/desk-api', () => new Proxy({}, { get: (_t, name: string) => (mockApi as Record<string, unknown>)[name] ?? jest.fn() }));

describe('the Desk tab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows what’s due today across boards, then the boards', async () => {
    await render(<DeskScreen />);
    expect(await screen.findByText('Pay electricity bill')).toBeTruthy();
    expect(mockApi.fetchToday).toHaveBeenCalledWith(today);
    expect(screen.getByText('Every month')).toBeTruthy();
    expect(await screen.findByText('3 to-dos · 2 notes · 1 file')).toBeTruthy();
    expect(screen.getByText('Everything about the flat')).toBeTruthy();
    expect(screen.getAllByText('Bills')).toHaveLength(2); // the board, and the board the due to-do is on
    // It says plainly that the Desk is private.
    expect(screen.getByText(/Only you can see your Desk/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Pay electricity bill' }));
    await waitFor(() => expect(mockApi.completeTodo).toHaveBeenCalledWith('t1', today));

    await fireEvent.press(screen.getByText('Home'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/desk/board/[id]', params: { id: 'b1' } });
    await fireEvent.press(screen.getByText('New board'));
    expect(mockPush).toHaveBeenCalledWith('/desk/board-form');
  });
});

describe('the board form', () => {
  beforeEach(() => jest.clearAllMocks());

  it('makes a board with a name and an optional description, then opens it', async () => {
    mockParams = {};
    await render(<BoardFormScreen />);
    await fireEvent.changeText(screen.getByLabelText('Description (optional)'), 'Kitchen first');
    expect(screen.getByRole('button', { name: 'Create board' }).props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Renovation');
    await fireEvent.press(screen.getByRole('button', { name: 'Create board' }));
    await waitFor(() => expect(mockApi.createBoard).toHaveBeenCalledWith({ name: 'Renovation', description: 'Kitchen first' }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/desk/board/[id]', params: { id: 'b5' } });
  });

  it('edits a board’s name and description', async () => {
    mockParams = { id: 'b1' };
    await render(<BoardFormScreen />);
    expect(await screen.findByDisplayValue('Everything about the flat')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Flat');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockApi.updateBoard).toHaveBeenCalledWith('b1', { name: 'Flat', description: 'Everything about the flat' }));
  });
});

describe('a board', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: 'b1' };
  });

  it('shows open to-dos, adds new ones, and keeps done ones folded away', async () => {
    await render(<BoardScreen />);
    expect(await screen.findByText('Fix the tap')).toBeTruthy();
    expect(screen.getByText('Everything about the flat')).toBeTruthy(); // the board's description
    expect(screen.queryByText('Clean gutters')).toBeNull();
    await fireEvent.press(screen.getByText('Show 1 done'));
    expect(screen.getByText('Clean gutters')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Add a to-do'), 'Buy light bulbs');
    await fireEvent(screen.getByLabelText('Add a to-do'), 'submitEditing');
    await waitFor(() => expect(mockApi.createTodo).toHaveBeenCalledWith({ boardId: 'b1', title: 'Buy light bulbs' }));
    expect(await screen.findByText('Buy light bulbs')).toBeTruthy();
  });

  it('has notes and files tabs', async () => {
    await render(<BoardScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Notes' }));
    expect(await screen.findByText('Hotel options')).toBeTruthy();
    expect(screen.getByText('Three places near the beach')).toBeTruthy();
    expect(screen.getByText('2 comments')).toBeTruthy();
    await fireEvent.press(screen.getByText('Hotel options'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/desk/note/[id]', params: { id: 'n1' } });
    await fireEvent.press(screen.getByRole('button', { name: 'New note' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/desk/note/[id]', params: { id: 'new', board: 'b1' } });

    await fireEvent.press(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('Boarding pass')).toBeTruthy();
    expect(screen.getByText('Seat 14A')).toBeTruthy();
    expect(screen.getByText(/120 KB/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Boarding pass'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/desk/file/[id]', params: { id: 'x1' } });
  });
});

describe('a to-do', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: 't2' };
  });

  it('can be given a description, a due date and a repeat', async () => {
    await render(<TodoScreen />);
    expect(await screen.findByDisplayValue('Fix the tap')).toBeTruthy();
    expect(screen.getByText('Home')).toBeTruthy(); // the board it's on
    await fireEvent.changeText(screen.getByLabelText('Description'), 'Kitchen, not bathroom');
    await fireEvent.press(screen.getByRole('radio', { name: 'Every week' }));
    // A repeat needs a day to count from: today unless one is chosen.
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mockApi.updateTodo).toHaveBeenCalledWith('t2', {
        boardId: 'b1', title: 'Fix the tap', description: 'Kitchen, not bathroom', dueDate: today, repeat: { kind: 'weekly', every: 1 },
      }),
    );
  });

  it('shows its comments and takes new ones', async () => {
    await render(<TodoScreen />);
    expect(await screen.findByText('Washer is 1/2 inch')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Bought the washer');
    await fireEvent.press(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledWith('todos', 't2', 'Bought the washer'));
    expect(await screen.findByText('Bought the washer')).toBeTruthy();
  });
});

describe('a note', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows its comments and takes new ones', async () => {
    mockParams = { id: 'n1' };
    await render(<NoteScreen />);
    expect(await screen.findByDisplayValue('Three places near the beach.')).toBeTruthy();
    expect(screen.getByText('Called, the second one is full')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Booked the third');
    await fireEvent.press(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledWith('notes', 'n1', 'Booked the third'));
  });

  it('is written on the board it was started from, and needs a title', async () => {
    mockParams = { id: 'new', board: 'b1' };
    await render(<NoteScreen />);
    await fireEvent.changeText(screen.getByLabelText('Description'), 'Just words');
    expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Title'), 'Packing');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(mockApi.createNote).toHaveBeenCalledWith({ boardId: 'b1', title: 'Packing', description: 'Just words' }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/desk/note/[id]', params: { id: 'n7' } });
  });
});

describe('a file', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: 'x1' };
  });

  it('opens, takes a new title and description, and has comments', async () => {
    await render(<FileScreen />);
    expect(await screen.findByDisplayValue('Boarding pass')).toBeTruthy();
    expect(screen.getByText('Gate 22')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Boarding pass.pdf' }));
    expect(mockOpenLink).toHaveBeenCalledWith('https://files.example/a');

    await fireEvent.changeText(screen.getByLabelText('Title'), 'Flight PK-301');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockApi.updateFile).toHaveBeenCalledWith('x1', { boardId: 'b1', title: 'Flight PK-301', description: 'Seat 14A' }));

    await fireEvent.changeText(screen.getByLabelText('Add a comment'), 'Boarding at 9');
    await fireEvent.press(screen.getByRole('button', { name: 'Post comment' }));
    await waitFor(() => expect(mockApi.addComment).toHaveBeenCalledWith('files', 'x1', 'Boarding at 9'));
  });
});
