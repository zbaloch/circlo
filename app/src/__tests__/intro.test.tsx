import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { Intro, INTRO_PAGES } from '@/components/intro';
import { GetStarted, getStartedSteps } from '@/components/get-started';
import AboutScreen from '@/app/settings/about';
import { introStartPage } from '@/lib/intro';
import type { Connection } from '@/lib/friends';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: () => mockBack(), navigate: (p: unknown) => mockNavigate(p), canGoBack: () => true },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
let mockSeen: string | null = null;
const mockSet = jest.fn(async () => {});
jest.mock('@/lib/storage', () => ({
  getItem: async () => mockSeen,
  setItem: (...a: unknown[]) => mockSet(...(a as [])),
}));
const mockOpen = jest.fn();
jest.mock('@/lib/links', () => ({ ...jest.requireActual('@/lib/links'), openLink: (u: string) => mockOpen(u) }));

describe('intro screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSeen = null;
  });

  it('tells the story in four screens, ending on private by design', () => {
    expect(INTRO_PAGES.map((p) => p.title)).toEqual(['The anti-social network', 'Your people, in circles', 'Invite only', 'Private by design']);
    expect(INTRO_PAGES[3].body).toMatch(/No tracking, no advertising IDs/);
  });

  it('starts at the first screen the first time, then on the last one (with the buttons)', () => {
    expect(introStartPage(false)).toBe(0);
    expect(introStartPage(true)).toBe(3);
  });

  it('first launch: from the start, noted as seen; Skip goes to the last screen', async () => {
    await render(<Intro mode="start" />);
    expect(await screen.findByLabelText('Screen 1 of 4')).toBeTruthy();
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('circlo.intro-seen', '1'));
    await fireEvent.press(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByLabelText('Screen 4 of 4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('Next walks through the screens', async () => {
    await render(<Intro mode="start" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByLabelText('Screen 2 of 4')).toBeTruthy();
  });

  it('later launches open on the last screen; its buttons create an account or log in', async () => {
    mockSeen = '1';
    await render(<Intro mode="start" />);
    expect(await screen.findByLabelText('Screen 4 of 4')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    expect(mockPush).toHaveBeenCalledWith('/signup');
    await fireEvent.press(screen.getByRole('button', { name: 'Log in' }));
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('watching it again (signed in): from the start, Close any time, Done at the end', async () => {
    mockSeen = '1';
    await render(<Intro mode="replay" />);
    expect(await screen.findByLabelText('Screen 1 of 4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(mockBack).toHaveBeenCalledTimes(2);
  });
});

describe('Get started on an empty Home', () => {
  const conn = (status: Connection['status']): Connection => ({ userId: status, status, profile: { displayName: 'A', handle: 'a', bio: '' } });

  it('has two steps: invite someone, then write a post; inviting ticks once someone is connected', () => {
    expect(getStartedSteps([]).map((s) => [s.key, s.done])).toEqual([['invite', false], ['post', false]]);
    expect(getStartedSteps([conn('accepted')])[0]).toMatchObject({ done: true, title: 'Invite someone' });
    // A waiting request is the quickest way in.
    expect(getStartedSteps([conn('incoming')])[0]).toMatchObject({ done: false, actionLabel: 'Review request' });
  });

  it('opens the invite screen and the composer', async () => {
    await render(<GetStarted connections={[]} />);
    expect(screen.getByText('Get started')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Invite' }));
    expect(mockPush).toHaveBeenCalledWith('/invite');
    await fireEvent.press(screen.getByRole('button', { name: 'Write' }));
    expect(mockPush).toHaveBeenCalledWith('/compose');
  });
});

describe('About Circlo', () => {
  it('has Why Circlo and the intro again', async () => {
    await render(<AboutScreen />);
    await fireEvent.press(screen.getByText('Why Circlo'));
    expect(mockOpen).toHaveBeenCalledWith('https://www.hellocirclo.com/why');
    await fireEvent.press(screen.getByText('Watch the intro again'));
    expect(mockPush).toHaveBeenCalledWith('/intro');
  });
});
