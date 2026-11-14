import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DeskScreen } from '@/app/(drawer)/(tabs)/desk';
import ListScreen from '@/app/desk/list/[id]';
import NoteScreen from '@/app/desk/note/[id]';
import TodoScreen from '@/app/desk/todo/[id]';
import { FilesView } from '@/components/desk/files-view';
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
  id, listId: 'l1', listName: 'Home', title, notes: '', dueDate: null, repeat: null, doneAt: null, createdAt: '2026-11-14T08:00:00Z', ...extra,
});

const mockApi = {
  fetchToday: jest.fn(async () => [todo('t1', 'Pay electricity bill', { dueDate: today, repeat: { kind: 'monthly', every: 1 } })]),
  fetchLists: jest.fn(async () => [{ id: 'l1', name: 'Home', open: 3, done: 2, createdAt: '2026-11-01T00:00:00Z' }]),
  completeTodo: jest.fn(async (id: string) => ({ todo: todo(id, 'x', { doneAt: '2026-11-14T09:00:00Z' }), next: todo('t9', 'x', { dueDate: '2026-12-14' }) })),
  uncompleteTodo: jest.fn(async () => todo('t1', 'x')),
  fetchNotes: jest.fn(async () => [
    { id: 'n1', title: 'Hotel options', snippet: 'Three places near the beach', pinned: true, followups: 2, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' },
  ]),
  fetchList: jest.fn(async () => ({ id: 'l1', name: 'Home', open: [todo('t2', 'Fix the tap')], done: [todo('t3', 'Clean gutters', { doneAt: '2026-11-12T00:00:00Z' })] })),
  createTodo: jest.fn(async (input: { title: string }) => todo('t4', input.title)),
  fetchTodo: jest.fn(async () => ({ ...todo('t2', 'Fix the tap'), history: [] })),
  updateTodo: jest.fn(async (_id: string, input: object) => ({ ...todo('t2', 'Fix the tap'), ...input })),
  fetchNote: jest.fn(async () => ({
    id: 'n1', title: 'Hotel options', body: 'Three places near the beach.', pinned: false, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z',
    followups: [{ id: 'f1', body: 'Called, the second one is full', createdAt: '2026-11-12T00:00:00Z' }],
  })),
  addFollowup: jest.fn(async (_id: string, body: string) => ({ id: 'f2', body, createdAt: '2026-11-14T00:00:00Z' })),
  createNote: jest.fn(),
  updateNote: jest.fn(),
  fetchFolder: jest.fn(async () => ({
    folder: null,
    path: [],
    folders: [{ id: 'd1', name: 'Karachi trip', items: 3, createdAt: '2026-11-01T00:00:00Z' }],
    files: [{
      id: 'x1', folderId: null, name: 'Boarding pass.pdf', mime: 'application/pdf', kind: 'file', sizeBytes: 120_000, width: 0, height: 0, durationMs: 0,
      objectKey: 'a'.repeat(64), url: 'https://files.example/a', previewKey: null, previewUrl: null, createdAt: '2026-11-14T00:00:00Z',
    }],
  })),
};
jest.mock('@/lib/desk-api', () => new Proxy({}, { get: (_t, name: string) => (mockApi as Record<string, unknown>)[name] ?? jest.fn() }));

describe('the Desk tab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens on to-dos: what’s due today across lists, then the lists', async () => {
    await render(<DeskScreen />);
    expect(await screen.findByText('Pay electricity bill')).toBeTruthy();
    expect(mockApi.fetchToday).toHaveBeenCalledWith(today);
    expect(screen.getByText('Every month')).toBeTruthy();
    expect(await screen.findByText('3 to do')).toBeTruthy();
    expect(screen.getAllByText('Home')).toHaveLength(2); // the list, and the list the due to-do is in
    // It says plainly that the Desk is private.
    expect(screen.getByText(/Only you can see your Desk/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Pay electricity bill' }));
    await waitFor(() => expect(mockApi.completeTodo).toHaveBeenCalledWith('t1', today));

    await fireEvent.press(screen.getByText('3 to do'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/desk/list/[id]', params: { id: 'l1' } });
  });

  it('has notes and files tabs', async () => {
    await render(<DeskScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Notes' }));
    expect(await screen.findByText('Hotel options')).toBeTruthy();
    expect(screen.getByText('Three places near the beach')).toBeTruthy();
    await fireEvent.press(screen.getByText('Hotel options'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/desk/note/[id]', params: { id: 'n1' } });

    await fireEvent.press(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('Karachi trip')).toBeTruthy();
  });
});

describe('a to-do list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: 'l1' };
  });

  it('shows open to-dos, adds new ones, and keeps done ones folded away', async () => {
    await render(<ListScreen />);
    expect(await screen.findByText('Fix the tap')).toBeTruthy();
    expect(screen.queryByText('Clean gutters')).toBeNull();
    await fireEvent.press(screen.getByText('Show 1 done'));
    expect(screen.getByText('Clean gutters')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Add a to-do'), 'Buy light bulbs');
    await fireEvent(screen.getByLabelText('Add a to-do'), 'submitEditing');
    await waitFor(() => expect(mockApi.createTodo).toHaveBeenCalledWith({ listId: 'l1', title: 'Buy light bulbs' }));
    expect(await screen.findByText('Buy light bulbs')).toBeTruthy();
  });
});

describe('a to-do', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: 't2' };
  });

  it('can be given a due date and a repeat', async () => {
    await render(<TodoScreen />);
    expect(await screen.findByDisplayValue('Fix the tap')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Every week' }));
    // A repeat needs a day to count from: today unless one is chosen.
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mockApi.updateTodo).toHaveBeenCalledWith('t2', { listId: 'l1', title: 'Fix the tap', notes: '', dueDate: today, repeat: { kind: 'weekly', every: 1 } }),
    );
  });
});

describe('a note', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: 'n1' };
  });

  it('shows its follow-ups and takes new ones', async () => {
    await render(<NoteScreen />);
    expect(await screen.findByText('Called, the second one is full')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Add a follow-up'), 'Booked the third');
    await fireEvent.press(screen.getByRole('button', { name: 'Add follow-up' }));
    await waitFor(() => expect(mockApi.addFollowup).toHaveBeenCalledWith('n1', 'Booked the third'));
    expect(await screen.findByText('Booked the third')).toBeTruthy();
  });
});

describe('files', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists folders and files; folders open, documents open in the browser', async () => {
    await render(<FilesView folderId={null} />);
    expect(await screen.findByText('Karachi trip')).toBeTruthy();
    expect(screen.getByText('3 items')).toBeTruthy();
    expect(screen.getByText(/120 KB/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Karachi trip'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/desk/folder/[id]', params: { id: 'd1' } });
    await fireEvent.press(screen.getByText('Boarding pass.pdf'));
    expect(mockOpenLink).toHaveBeenCalledWith('https://files.example/a');
  });
});
