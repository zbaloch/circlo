import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import PersonScreen from '@/app/people/[id]';
import { PeopleList } from '@/components/people-ui';
import type { Connection } from '@/lib/friends';
import type { Contact, ContactFields, ContactNote } from '@/lib/people';
import { clearPeople, refreshPeople } from '@/lib/people-store';
import { pushRoute } from '@/lib/push-route';

jest.setTimeout(20_000);

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockSetParams = jest.fn();
let mockParams: Record<string, string> = {};
let mockHeaderRight: (() => ReactElement | null) | undefined;
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: () => mockBack(), setParams: (p: unknown) => mockSetParams(p) },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: (o: { headerRight?: () => ReactElement | null }) => (mockHeaderRight = o.headerRight) }),
}));
jest.mock('@/api/client', () => ({ api: {}, ok: jest.fn(), API_URL: 'http://api.test' }));
jest.mock('@/components/keyboard-spacer', () => ({ KeyboardSpacer: () => null }));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedIn', account: { userId: 'me' } }) }));
jest.mock('@/lib/use-connections', () => ({ displayName: (c: { profile: { displayName: string } }) => c.profile.displayName }));
jest.mock('@/lib/messaging', () => ({ startChat: jest.fn(async () => 'chat-1') }));
const mockToast = jest.fn();
jest.mock('@/lib/toast', () => ({ showToast: (m: string) => mockToast(m) }));
type Btn = { text: string; style?: string; onPress?: () => void };
const mockAlert = jest.fn();
jest.mock('@/lib/dialog', () => ({ showAlert: (t: string, m?: string, b?: Btn[]) => mockAlert(t, m, b) }));
const mockSchedule = jest.fn(async (_people: Contact[]) => {});
jest.mock('@/lib/people-reminders', () => ({
  schedulePeopleReminders: (p: Contact[]) => mockSchedule(p),
  cancelPeopleReminders: jest.fn(async () => {}),
}));

let mockPeople: Contact[] = [];
let mockNotes: ContactNote[] = [];
const mockAddPerson = jest.fn(async (name: string, userId?: string): Promise<Contact> =>
  entry({ contactId: `new-${name}`, name, person: userId ? { userId, name, username: 'ana' } : null }),
);
const mockSave = jest.fn(async (id: string, f: ContactFields): Promise<Contact> => entry({ contactId: id, ...f }));
const mockAddNote = jest.fn(
  async (_id: string, n: { body?: string; caughtUp?: boolean; at?: string }): Promise<ContactNote> => ({
    noteId: `note-${mockAddNote.mock.calls.length}`,
    body: n.body ?? '',
    caughtUp: !!n.caughtUp,
    at: new Date().toISOString(),
  }),
);
jest.mock('@/lib/people', () => ({
  ...jest.requireActual('@/lib/people'),
  loadPeople: async () => mockPeople,
  addPerson: (name: string, userId?: string) => mockAddPerson(name, userId),
  savePerson: (id: string, f: ContactFields) => mockSave(id, f),
  loadPersonNotes: async () => mockNotes,
  addPersonNote: (id: string, n: { body?: string; caughtUp?: boolean; at?: string }) => mockAddNote(id, n),
  deletePersonNote: jest.fn(async () => {}),
}));

function entry(over: Partial<Contact> = {}): Contact {
  return { contactId: 'c1', name: 'Sam', person: null, dates: [], keepInTouchDays: null, keepSince: null, lastCaughtUp: null, noteCount: 0, ...over };
}

const today = new Date();
const inDays = (n: number) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
  return { month: d.getMonth() + 1, day: d.getDate() };
};
const ana: Connection = { userId: 'a', status: 'accepted', profile: { displayName: 'Ana', handle: 'ana', bio: '' } } as unknown as Connection;

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  mockNotes = [];
  await clearPeople();
});

describe('People: my connections and the people I add, in one list', () => {
  const grandma = entry({ contactId: 'g1', name: 'Grandma', keepInTouchDays: 7, keepSince: new Date(today.getTime() - 30 * 86_400_000).toISOString() });
  const anaRow = entry({ contactId: null, name: 'Ana', person: { userId: 'a', name: 'Ana', username: 'ana' }, dates: [{ label: 'Birthday', ...inDays(1), year: null }] });

  it('shows Coming up, then everyone; a connection opens their profile, anyone else their page', async () => {
    await render(<PeopleList people={[anaRow, grandma]} friends={[ana]} book={null} today={today} />);
    expect(screen.getByText('Coming up')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Grandma, Time to catch up (every week)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ana, Birthday tomorrow' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /^Ana, @ana, Birthday tomorrow/ }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/friend/[id]', params: { id: 'a' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Grandma, Time to catch up' }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/people/[id]', params: { id: 'g1' } });
  });

  it('adds someone who isn’t on Circlo by name, then opens their page', async () => {
    await render(<PeopleList people={[]} friends={[]} book={null} today={today} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add someone' }));
    await fireEvent.changeText(await screen.findByLabelText('Name'), '  Nan ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockAddPerson).toHaveBeenCalledWith('Nan', undefined));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/people/[id]', params: { id: 'new-Nan' } });
  });
});

describe('A person’s page', () => {
  it('sets how often to catch up, logs a catch-up and adds notes, with their days shown', async () => {
    mockPeople = [entry({ contactId: 'g1', name: 'Grandma' })];
    mockNotes = [{ noteId: 'n1', body: 'Loves gardening', caughtUp: false, at: '2025-03-12T12:00:00Z' }];
    await refreshPeople();
    mockParams = { id: 'g1' };
    await render(<PersonScreen />);
    expect(screen.getByText('Grandma')).toBeTruthy();
    expect(screen.getByText(/Not on Circlo/)).toBeTruthy();
    expect(await screen.findByText('Loves gardening')).toBeTruthy();
    expect(screen.getByText('12 March 2025')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Month' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('g1', { name: 'Grandma', keepInTouchDays: 30, dates: [] }));

    await fireEvent.press(screen.getByRole('button', { name: 'Caught up' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'A day earlier' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockAddNote).toHaveBeenCalledWith('g1', expect.objectContaining({ body: '', caughtUp: true, at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })));

    await fireEvent.changeText(screen.getByLabelText('New note'), 'Starting a new job');
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(mockAddNote).toHaveBeenLastCalledWith('g1', { body: 'Starting a new job', caughtUp: false, at: undefined }));
    expect(await screen.findByText('Starting a new job')).toBeTruthy();
  });

  it('adds a birthday', async () => {
    mockPeople = [entry({ contactId: 'g1', name: 'Grandma' })];
    await refreshPeople();
    mockParams = { id: 'g1' };
    await render(<PersonScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add a birthday or another date' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Mar' }));
    await fireEvent.changeText(screen.getByLabelText('Day'), '14');
    await fireEvent.changeText(screen.getByLabelText('Year (if you know it)'), '1950');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith('g1', { name: 'Grandma', keepInTouchDays: null, dates: [{ label: 'Birthday', month: 3, day: 14, year: 1950 }] }),
    );
  });

  it('makes the entry for a connection with the first thing I write about them', async () => {
    mockPeople = [entry({ contactId: null, name: 'Ana', person: { userId: 'a', name: 'Ana', username: 'ana' } })];
    await refreshPeople();
    mockParams = { id: 'u-a' };
    await render(<PersonScreen />);
    expect(screen.getByText(/@ana · on Circlo/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View profile' })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('New note'), 'Met at uni');
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(mockAddPerson).toHaveBeenCalledWith('Ana', 'a'));
    expect(mockAddNote).toHaveBeenCalledWith('new-Ana', { body: 'Met at uni', caughtUp: false, at: undefined });
    expect(mockSetParams).toHaveBeenCalledWith({ id: 'new-Ana' });
  });

  it('opens from a reminder', () => {
    const id = '01a22196-efe3-75af-adfa-e4c5b8e18986';
    expect(pushRoute({ type: 'people', contactId: id })).toEqual({ pathname: '/people/[id]', params: { id } });
    expect(pushRoute({ type: 'people', contactId: '../x' })).toBe('/notifications');
  });

  it('reschedules the phone’s reminders when People changes', async () => {
    jest.useFakeTimers();
    try {
      mockPeople = [entry({ contactId: 'g1', name: 'Grandma' })];
      await refreshPeople();
      jest.advanceTimersByTime(1500);
      expect(mockSchedule).toHaveBeenCalledWith(mockPeople);
    } finally {
      jest.useRealTimers();
    }
  });
});

void mockHeaderRight;
