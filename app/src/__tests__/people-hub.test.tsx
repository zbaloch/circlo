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
let mockConnections: unknown[] = [ana];
jest.mock('@/lib/use-connections', () => ({
  useConnections: () => ({ account, connections: mockConnections, unseenRequests: [], refresh: jest.fn(async () => {}) }),
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

const tabs = () => screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel);
const selected = (name: string) => screen.getByRole('tab', { name }).props.accessibilityState.selected;

describe('People: your people, your circles and inviting, in one tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockConnections = [ana];
  });

  it('has three sections, and opens on People once you have people', async () => {
    await render(<PeopleHub />);
    expect(tabs()).toEqual(['People (1)', 'Circles', 'Invites']);
    expect(selected('People (1)')).toBe(true);
    expect(await screen.findByText('Everyone, Family')).toBeTruthy();
    // No separate Add people button any more.
    expect(screen.queryByRole('button', { name: 'Add people' })).toBeNull();
  });

  it('opens on Invite while you have no people yet', async () => {
    mockConnections = [];
    await render(<PeopleHub />);
    expect(selected('Invites')).toBe(true);
  });

  it('Invite offers two clear choices, each opening its own screen', async () => {
    mockParams = { section: 'invite' };
    await render(<PeopleHub />);
    expect(selected('Invites')).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: /^Invite someone/ }));
    expect(mockPush).toHaveBeenCalledWith('/invite');
    await fireEvent.press(screen.getByRole('button', { name: /^Got an invite\?/ }));
    expect(mockPush).toHaveBeenCalledWith('/join');
    // The code and the paste box live on those screens, not here.
    expect(screen.queryByLabelText('Invite link')).toBeNull();
    expect(screen.queryByText('Connect')).toBeNull();
  });

  it('the Invite someone screen shows your code and link', async () => {
    await render(<PeopleHub only="invite" />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(await screen.findByLabelText('Invite link')).toBeTruthy();
  });

  it('the Got an invite? screen has scan and paste, with a waiting link filled in', async () => {
    mockTake.mockReturnValueOnce('https://www.hellocirclo.com/i/xyz' as never);
    await render(<PeopleHub only="join" />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByDisplayValue('https://www.hellocirclo.com/i/xyz')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('Circles lists Only me, Everyone and your circles, each opening its screen, and New circle', async () => {
    await render(<PeopleHub />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Circles' }));
    expect(await screen.findByText('Only me (my mind)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Family, 1 person/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/circle/[n]', params: { n: '1' } });
    await fireEvent.press(screen.getByText('New circle'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/circle/[n]', params: { n: 'new' } });
  });

  it('a link can open a section directly', async () => {
    mockParams = { section: 'circles' };
    await render(<PeopleHub />);
    expect(selected('Circles')).toBe(true);
  });
});
