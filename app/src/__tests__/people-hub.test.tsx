import { fireEvent, render, screen } from '@testing-library/react-native';

import { PeopleHub } from '@/components/people-hub';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/api/client', () => ({}));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
const account = { userId: 'me', handle: 'me' };
const ana = { userId: 'a', status: 'accepted', profile: { displayName: 'Ana', handle: 'ana', bio: '' } };
jest.mock('@/lib/use-connections', () => ({
  useConnections: () => ({ account, connections: [ana], unseenRequests: [], refresh: jest.fn(async () => {}) }),
  displayName: (c: { profile: { displayName: string } }) => c.profile.displayName,
  markRequestsSeen: jest.fn(),
}));
const mockCircles = [{ id: 1, name: 'Family' }, { id: 2, name: 'Close Friends' }, { id: 3, name: 'School' }, { id: 4, name: 'Work' }, { id: 5, name: 'Acquaintances' }];
const mockBook = { circleDefs: mockCircles, contacts: { a: { status: 'accepted', displayName: 'Ana', handle: 'ana', circles: [1] } } };
jest.mock('@/lib/addressbook', () => ({
  ...jest.requireActual('@/lib/addressbook'),
  loadAddressBook: async () => mockBook,
  refreshAddressBook: async () => mockBook,
}));
jest.mock('@/lib/friends', () => ({
  ...jest.requireActual('@/lib/friends'),
  getInviteLink: async () => 'https://www.hellocirclo.com/i/tok',
}));
const mockTake = jest.fn(() => null);
jest.mock('@/lib/pending-invite', () => ({ takePendingInvite: () => mockTake() }));

describe('People: your people and your circles in one place', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
  });

  it('has two sections, People and Circles, and nothing about invites', async () => {
    await render(<PeopleHub mode="people" />);
    const tabs = screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel);
    expect(tabs).toEqual(['People (1)', 'Circles']);
    expect(await screen.findByText('Everyone, Family')).toBeTruthy();
    // It leaves a waiting invite link alone (Add people takes it).
    expect(mockTake).not.toHaveBeenCalled();
  });

  it('Circles lists Only me, Everyone and your circles, each opening its screen, and New circle', async () => {
    await render(<PeopleHub mode="people" />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Circles' }));
    expect(await screen.findByText('Only me (my mind)')).toBeTruthy();
    expect(screen.getByText('Everyone')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Family, 1 person/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/circle/[n]', params: { n: '1' } });
    await fireEvent.press(screen.getByText('New circle'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/circle/[n]', params: { n: 'new' } });
  });

  it('a link can open Circles directly', async () => {
    mockParams = { section: 'circles' };
    await render(<PeopleHub mode="people" />);
    expect(screen.getByRole('tab', { name: 'Circles' }).props.accessibilityState.selected).toBe(true);
  });
});

describe('Add people: the two ways to connect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
  });

  it('opens on Invite someone (your QR code and link), with Got an invite? next to it', async () => {
    await render(<PeopleHub mode="add" />);
    const tabs = screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel);
    expect(tabs).toEqual(['Invite someone', 'Got an invite?']);
    expect(screen.getByRole('tab', { name: 'Invite someone' }).props.accessibilityState.selected).toBe(true);
    expect(await screen.findByLabelText('Invite link')).toBeTruthy();
  });

  it('opens on Got an invite? when a link says so, with a waiting invite link filled in', async () => {
    mockParams = { section: 'join' };
    mockTake.mockReturnValueOnce('https://www.hellocirclo.com/i/xyz' as never);
    await render(<PeopleHub mode="add" />);
    expect(screen.getByRole('tab', { name: 'Got an invite?' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByDisplayValue('https://www.hellocirclo.com/i/xyz')).toBeTruthy();
  });
});
