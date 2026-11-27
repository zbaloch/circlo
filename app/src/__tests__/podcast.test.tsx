import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ArticleScreen from '@/app/feeds/[id]';
import { MiniPlayer } from '@/components/podcast-player';
import { ArticleRow } from '@/components/reading-ui';
import { clock, getPlayerState, lengthLabel, nextRate, playEpisode, savedPosition, stopPodcast, withPosition } from '@/lib/podcast-player';
import { episodeOf, originalLabel, type Article, type ArticleDetail } from '@/lib/reading';

jest.setTimeout(20_000);

// A stand-in for expo-audio's player: records what Circlo asks of it, and lets a test send its status updates.
type Status = { isLoaded: boolean; playing: boolean; isBuffering: boolean; currentTime: number; duration: number; didJustFinish: boolean };
const mockPlayer = {
  listener: null as ((s: Status) => void) | null,
  addListener: jest.fn((_event: string, l: (s: Status) => void) => {
    mockPlayer.listener = l;
    return { remove: jest.fn() };
  }),
  replace: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(async (_s: number) => {}),
  setPlaybackRate: jest.fn(),
  setActiveForLockScreen: jest.fn(),
  clearLockScreenControls: jest.fn(),
  remove: jest.fn(),
};
const mockAudioMode = jest.fn(async (_m: unknown) => {});
jest.mock('expo-audio', () => ({
  createAudioPlayer: () => mockPlayer,
  setAudioModeAsync: (m: unknown) => mockAudioMode(m),
}));
const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  getItem: async (k: string) => mockStore.get(k) ?? null,
  setItem: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItem: async (k: string) => void mockStore.delete(k),
}));
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
}));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedIn', account: { userId: 'me', handle: 'me' } }) }));
jest.mock('@/api/client', () => ({ API_URL: 'http://api.test' }));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));
const mockOpen = jest.fn(async (_url: string, _opts?: unknown) => ({ type: 'opened' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string, opts: unknown) => mockOpen(url, opts) }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-image', () => ({ Image: (p: object) => jest.requireActual('react').createElement('Image', p) }));
jest.mock('@/components/send-to-chat-sheet', () => ({ SendToChatSheet: () => null }));
const mockSetRead = jest.fn(async (_id: string, _read: boolean) => {});
let mockDetail: ArticleDetail | null = null;
jest.mock('@/lib/reading', () => ({
  ...jest.requireActual('@/lib/reading'),
  setRead: (id: string, read: boolean) => mockSetRead(id, read),
  loadArticle: async () => mockDetail,
}));

const episode = (id: string, extra: Partial<Article> = {}): Article => ({
  articleId: id,
  sourceId: 's1',
  sourceTitle: 'TED Health',
  title: 'How to find your way when you feel lost',
  summary: 'If you feel like you’ve lost your way at work…',
  url: 'https://audiocollective.ted.com/',
  author: null,
  publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  read: false,
  hasContent: true,
  sourceIcon: '/v1/reading/image?u=logo&e=1&s=a',
  audio: { url: `https://sphinx.acast.example/${id}/media.mp3`, type: 'audio/mpeg', durationSeconds: 2212 },
  image: '/v1/reading/image?u=art&e=1&s=b',
  ...extra,
});

/** Lets playEpisode's setup (audio mode, the saved position) finish, as it does before the real player reports. */
const settle = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));

async function status(s: Partial<Status>) {
  await act(async () => mockPlayer.listener?.({ isLoaded: true, playing: true, isBuffering: false, currentTime: 0, duration: 2212, didJustFinish: false, ...s }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

afterEach(async () => {
  await act(async () => stopPodcast());
  mockStore.clear();
});

describe('Podcast logic', () => {
  it('words for times, lengths and speeds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(2212)).toBe('36:52');
    expect(clock(3723)).toBe('1:02:03');
    expect(lengthLabel(2212)).toBe('37 min');
    expect(lengthLabel(3723)).toBe('1 hr 2 min');
    expect(lengthLabel(7200)).toBe('2 hr');
    expect([1, 1.25, 1.5, 2].map(nextRate)).toEqual([1.25, 1.5, 2, 1]);
  });

  it('remembers the latest 30 episodes’ positions, and forgets finished ones', () => {
    let p = {};
    for (let i = 0; i < 35; i++) p = withPosition(p, `e${i}`, i * 10 + 0.7);
    expect(Object.keys(p)).toHaveLength(30);
    expect(p).toMatchObject({ e34: 340 });
    expect(p).not.toHaveProperty('e0');
    expect(withPosition(p, 'e34', null)).not.toHaveProperty('e34');
  });

  it('turns an episode into something to play, artwork through Circlo; articles have none', () => {
    expect(episodeOf(episode('p1'), 'http://api.test')).toEqual({
      articleId: 'p1',
      title: 'How to find your way when you feel lost',
      sourceTitle: 'TED Health',
      audioUrl: 'https://sphinx.acast.example/p1/media.mp3',
      durationSeconds: 2212,
      artwork: 'http://api.test/v1/reading/image?u=art&e=1&s=b',
    });
    expect(episodeOf(episode('p2', { image: null }), 'http://api.test')?.artwork).toBe('http://api.test/v1/reading/image?u=logo&e=1&s=a');
    expect(episodeOf(episode('a1', { audio: null }), 'http://api.test')).toBeNull();
    expect(originalLabel(episode('p1'))).toBe('Open on audiocollective.ted.com');
    expect(originalLabel({ url: 'https://www.densediscovery.com/issues/416', audio: null })).toBe('Read on densediscovery.com');
  });
});

describe('Playing an episode', () => {
  it('plays from the podcast’s own server with lock-screen controls, and skips, seeks and changes speed', async () => {
    mockParams = { id: 'p1' };
    mockDetail = { article: episode('p1'), content: [{ type: 'p', runs: [{ text: 'Show notes here.' }] }] };
    await render(<ArticleScreen />);
    expect(await screen.findByText('Show notes here.')).toBeTruthy();
    expect(screen.getByText('Plays from the podcast’s own server.')).toBeTruthy();
    expect(screen.getByText('37 min')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open on audiocollective.ted.com ↗' })).toBeTruthy();
    // Opening it reads it, as with articles.
    expect(mockSetRead).toHaveBeenCalledWith('p1', true);

    await fireEvent.press(screen.getByRole('button', { name: 'Play' }));
    await settle();
    expect(mockAudioMode).toHaveBeenCalledWith({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
    expect(mockPlayer.replace).toHaveBeenCalledWith({ uri: 'https://sphinx.acast.example/p1/media.mp3' });
    expect(mockPlayer.play).toHaveBeenCalled();
    expect(mockPlayer.setActiveForLockScreen).toHaveBeenCalledWith(
      true,
      { title: 'How to find your way when you feel lost', artist: 'TED Health', artworkUrl: 'http://api.test/v1/reading/image?u=art&e=1&s=b' },
      { showSeekBackward: true, showSeekForward: true },
    );

    await status({ currentTime: 600 });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.getByText('10:00')).toBeTruthy();
    expect(screen.getByText('-26:52')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Forward 30 seconds' }));
    expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(630);
    await fireEvent.press(screen.getByRole('button', { name: 'Back 15 seconds' }));
    expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(615);
    await fireEvent.press(screen.getByRole('button', { name: 'Speed 1×' }));
    expect(mockPlayer.setPlaybackRate).toHaveBeenLastCalledWith(1.25);
    expect(screen.getByRole('button', { name: 'Speed 1.25×' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(mockPlayer.pause).toHaveBeenCalled();
    // Its own screen doesn't show the small player bar.
    expect(screen.queryByRole('button', { name: 'How to find your way when you feel lost, TED Health' })).toBeNull();
  });

  it('remembers where I stopped, on this device, and starts there next time; a finished one starts over', async () => {
    await act(async () => playEpisode(episodeOf(episode('p1'), 'http://api.test')!));
    await status({ currentTime: 754.4, playing: false });
    await settle();
    expect(await savedPosition('p1')).toBe(754);
    await act(async () => stopPodcast());
    // Sign-out (stopPodcast) forgets every position; here one saved earlier is restored.
    mockStore.set('circlo.podcast-positions', JSON.stringify({ p1: 754 }));

    mockParams = { id: 'p1' };
    mockDetail = { article: episode('p1'), content: [] };
    await render(<ArticleScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Resume' }));
    await settle();
    await status({ currentTime: 0, playing: false, isBuffering: true });
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(754);

    await status({ currentTime: 2212, playing: false, didJustFinish: true });
    await settle();
    expect(await savedPosition('p1')).toBe(0);
  });

  it('keeps playing elsewhere in Feeds, with a bar to pause it or go back to it', async () => {
    await act(async () => playEpisode(episodeOf(episode('p1'), 'http://api.test')!));
    await status({ currentTime: 100 });
    await render(<MiniPlayer />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(mockPlayer.pause).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'How to find your way when you feel lost, TED Health' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/feeds/[id]', params: { id: 'p1' } });
    await act(async () => stopPodcast());
    expect(getPlayerState().episode).toBeNull();
    expect(mockPlayer.clearLockScreenControls).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('an episode row shows its length', async () => {
    await render(<ArticleRow article={episode('p1')} now={Date.now()} onOpen={jest.fn()} onMore={jest.fn()} />);
    expect(screen.getByText(/· 37 min/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /How to find your way/ }).props.accessibilityHint).toBe('Opens the episode');
  });
});
