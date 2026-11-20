import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PeopleYouMayKnow } from '@/components/people-you-may-know';
import { dismissedMayKnow, dismissMayKnow, showMayKnow, type MayKnowGroup } from '@/lib/circle-mates';

jest.setTimeout(20_000);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p) },
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/api/client', () => ({}));
const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  getItem: async (k: string) => mockStore.get(k) ?? null,
  setItem: async (k: string, v: string) => void mockStore.set(k, v),
}));
const person = (userId: string, name: string) => ({ userId, name, username: name.toLowerCase(), avatarUrl: null });
let mockGroups: MayKnowGroup[] = [];
jest.mock('@/lib/circle-mates', () => ({
  ...jest.requireActual('@/lib/circle-mates'),
  loadPeopleYouMayKnow: async () => mockGroups,
}));

const zaheer = person('z', 'Zaheer');
const imran = person('i', 'Imran');
const zulfi = person('u', 'Zulfi');

describe('People you may know on Home', () => {
  beforeEach(() => {
    mockStore.clear();
    mockPush.mockReset();
    mockGroups = [
      { owner: person('a', 'Ali'), people: [person('c', 'Cousin')] },
      { owner: zaheer, people: [imran, zulfi] },
    ];
  });

  it('names the people and the friend I’d know them through, and opens that friend’s list', async () => {
    await render(<PeopleYouMayKnow userId="me" />);
    expect(await screen.findByText('People you may know')).toBeTruthy();
    expect(screen.getByLabelText('You may know Cousin through Ali')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('You may know Imran and Zulfi through Zaheer'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/mates/[id]', params: { id: 'z' } });
    // Never a circle's name.
    expect(screen.queryByText(/Family|Close Friends/)).toBeNull();
  });

  it('closes when asked, remembering who was in it on this device', async () => {
    await render(<PeopleYouMayKnow userId="me" />);
    await fireEvent.press(await screen.findByLabelText('Close People you may know'));
    await waitFor(() => expect(screen.queryByText('People you may know')).toBeNull());
    expect(JSON.parse(mockStore.get('circlo.may-know-dismissed.me')!)).toEqual(['c', 'i', 'u']);
  });

  it('stays closed for the same people and comes back when someone new is listed', async () => {
    const closed = await dismissMayKnow('me', mockGroups, new Set());
    expect(await dismissedMayKnow('me')).toEqual(closed);
    expect(showMayKnow(mockGroups, closed)).toBe(false);
    // Fewer people (someone connected) still counts as nobody new.
    expect(showMayKnow([mockGroups[1]], closed)).toBe(false);
    const more = [...mockGroups, { owner: person('s', 'Sara'), people: [person('n', 'Nadia')] }];
    expect(showMayKnow(more, closed)).toBe(true);
    // Closing again keeps everyone seen so far.
    expect([...(await dismissMayKnow('me', more, closed))]).toEqual(['c', 'i', 'u', 'n']);
  });

  it('shows nothing when there’s nobody', async () => {
    mockGroups = [];
    await render(<PeopleYouMayKnow userId="me" />);
    await waitFor(() => expect(screen.queryByText('People you may know')).toBeNull());
    expect(showMayKnow([], new Set())).toBe(false);
  });

  it('lists three friends at most', async () => {
    mockGroups = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ owner: person(id, `Friend ${id}`), people: [person(`${id}1`, `Mate ${id}`)] }));
    await render(<PeopleYouMayKnow userId="me" />);
    expect(await screen.findByText(/And more through 2 other friends/)).toBeTruthy();
    expect(screen.queryByLabelText('You may know Mate d through Friend d')).toBeNull();
  });
});
