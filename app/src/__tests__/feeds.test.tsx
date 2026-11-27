import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';

import ArticleScreen from '@/app/feeds/[id]';
import AddSourceScreen from '@/app/feeds/add';
import ReadingScreen from '@/app/feeds/index';
import SourcesScreen from '@/app/feeds/sources';
import { DRAWER_ITEMS } from '@/components/app-drawer';
import {
  blockText,
  describeReadingError,
  imageUri,
  openOnSiteLabel,
  filterChips,
  importSummary,
  mergeArticles,
  READING_ABOUT,
  siteName,
  sourceStatus,
  unreadIn,
  withRead,
  withUnread,
  type Article,
  type ArticleDetail,
  type FoundSource,
  type Source,
} from '@/lib/reading';

jest.setTimeout(20_000);

const mockPush = jest.fn();
const mockSetOptions = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: () => mockBack(), navigate: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({
    setOptions: (o: { headerRight?: () => ReactElement }) => {
      mockSetOptions(o);
      mockLatestOptions = o;
      mockListeners.forEach((l) => l());
    },
  }),
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
const mockSession = { status: 'signedIn', account: { userId: 'me', handle: 'me' } };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('@/api/client', () => ({ API_URL: 'http://api.test' }));
const mockToast = jest.fn();
jest.mock('@/lib/toast', () => ({ showToast: (m: string) => mockToast(m) }));
const mockOpen = jest.fn(async (_url: string, _opts?: unknown) => ({ type: 'opened' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: (url: string, opts: unknown) => mockOpen(url, opts) }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-image', () => ({ Image: (p: { accessibilityLabel?: string }) => jest.requireActual('react').createElement('Image', { testID: 'article-image', ...p }) }));
jest.mock('@/components/send-to-chat-sheet', () => ({ SendToChatSheet: () => null }));
jest.mock('@/lib/opml-file', () => ({ pickOpmlText: jest.fn(), shareOpml: jest.fn() }));

const source = (id: string, title: string, extra: Partial<Source> = {}): Source => ({
  sourceId: id,
  title,
  feedUrl: `https://${id}.example/feed`,
  siteUrl: `https://www.${id}.example/`,
  updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  failingSince: null,
  unread: 1,
  ...extra,
});
const article = (id: string, title: string, read = false, hasContent = false): Article => ({
  articleId: id,
  sourceId: 's1',
  sourceTitle: 'Stratechery',
  title,
  summary: `About ${title}`,
  url: `https://stratechery.example/${id}`,
  author: null,
  publishedAt: new Date(Date.now() - 3600_000).toISOString(),
  read,
  hasContent,
});

let mockSources: Source[] = [];
let mockArticles: Article[] = [];
const mockSetRead = jest.fn(async (_id: string, _read: boolean) => {});
const mockFind = jest.fn(async (_url: string): Promise<FoundSource> => {
  throw Object.assign(new Error('no_feed'), { code: 'no_feed' });
});
const mockFollow = jest.fn(async (_url: string) => source('s9', 'Ars Technica'));
const mockSeen = jest.fn(async () => {});
let mockDetail: ArticleDetail | null = null;
jest.mock('@/lib/reading', () => ({
  ...jest.requireActual('@/lib/reading'),
  loadSources: async () => mockSources,
  loadArticles: async () => ({ articles: mockArticles, next: null }),
  setRead: (id: string, read: boolean) => mockSetRead(id, read),
  findSource: (url: string) => mockFind(url),
  followSource: (url: string) => mockFollow(url),
  markReadingSeen: () => mockSeen(),
  loadArticle: async () => {
    if (!mockDetail) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    return mockDetail;
  },
}));

/** Draws the header's right side next to the screen, as the stack would, so its buttons act on the live screen. */
type Options = { headerRight?: () => ReactElement };
let mockLatestOptions: Options = {};
const mockListeners = new Set<() => void>();
function WithHeader({ children }: { children: ReactNode }) {
  const options = useSyncExternalStore(
    (onChange) => {
      mockListeners.add(onChange);
      return () => mockListeners.delete(onChange);
    },
    () => mockLatestOptions,
  );
  const right = options.headerRight?.();
  return (
    <>
      {children}
      {right ? <View testID="header">{right}</View> : null}
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLatestOptions = {};
  mockParams = {};
});

describe('Feeds logic', () => {
  it('names sites without www', () => {
    expect(siteName('https://www.Stratechery.com/feed?x=1')).toBe('stratechery.com');
    expect(siteName('http://blog.example:8080/')).toBe('blog.example');
    expect(siteName(null)).toBe('');
  });

  it('says quietly when a source was last read or has stopped working', () => {
    const now = Date.parse('2026-11-27T12:00:00Z');
    expect(sourceStatus({ updatedAt: '2026-11-27T10:00:00Z', failingSince: null }, now)).toBe('Updated 2h ago');
    expect(sourceStatus({ updatedAt: null, failingSince: null }, now)).toBe('Checking soon');
    expect(sourceStatus({ updatedAt: null, failingSince: '2026-11-27T11:00:00Z' }, now)).toBe('Couldn’t update just now');
    expect(sourceStatus({ updatedAt: null, failingSince: '2026-11-23T11:00:00Z' }, now)).toBe('Couldn’t update since Monday');
  });

  it('chips are All, Unread, then each source', () => {
    expect(filterChips([source('a', 'Ars'), source('b', 'Bits')]).map((c) => c.label)).toEqual(['All', 'Unread', 'Ars', 'Bits']);
  });

  it('pages merge without repeats, and read marks one article', () => {
    const a = article('1', 'One');
    const b = article('2', 'Two');
    expect(mergeArticles([a, b], [b, article('3', 'Three')]).map((x) => x.articleId)).toEqual(['1', '2', '3']);
    expect(withRead([a, b], '2', true).map((x) => x.read)).toEqual([false, true]);
  });

  it('counts unread per filter, and keeps the counts current as I read', () => {
    const list = [source('a', 'Ars', { unread: 2 }), source('b', 'Bits', { unread: 3 })];
    expect(unreadIn(list, { kind: 'all' })).toBe(5);
    expect(unreadIn(list, { kind: 'unread' })).toBe(5);
    expect(unreadIn(list, { kind: 'source', sourceId: 'b' })).toBe(3);
    expect(unreadIn(withUnread(list, 'a', -1), { kind: 'all' })).toBe(4);
    expect(unreadIn(withUnread(list, 'a', -5), { kind: 'source', sourceId: 'a' })).toBe(0);
    expect(unreadIn(withUnread(list, 'b', 'none'), { kind: 'all' })).toBe(2);
    expect(unreadIn(withUnread(list, null, 'none'), { kind: 'all' })).toBe(0);
  });

  it('explains errors in plain words', () => {
    expect(describeReadingError({ code: 'no_feed' })).toMatch(/couldn’t find a feed/);
    expect(describeReadingError({ code: 'invalid_url' })).toMatch(/web address/);
    expect(describeReadingError({ code: 'too_many_sources' })).toMatch(/200/);
    expect(importSummary({ added: 3, skipped: 1 })).toBe('3 sources added · 1 couldn’t be read');
    expect(importSummary({ added: 0, skipped: 0 })).toBe('Nothing new to add');
  });

  it('names where the original opens, and puts images on Circlo’s own address', () => {
    expect(openOnSiteLabel('https://www.densediscovery.com/issues/416')).toBe('Read on densediscovery.com');
    expect(openOnSiteLabel('https://www.youtube.com/watch?v=abc')).toBe('Watch on YouTube');
    expect(openOnSiteLabel('https://youtu.be/abc')).toBe('Watch on YouTube');
    expect(imageUri('/v1/reading/image?u=x&e=1&s=y', 'http://192.168.1.2:8091/')).toBe('http://192.168.1.2:8091/v1/reading/image?u=x&e=1&s=y');
    expect(blockText([{ text: 'Hello ' }, { text: 'world', b: true }])).toBe('Hello world');
    expect(blockText(undefined)).toBe('');
  });

  it('sits in the drawer between Profile and Settings', () => {
    expect(DRAWER_ITEMS.map((i) => i.label)).toEqual(['Profile', 'Feeds', 'Settings and privacy']);
  });
});

describe('Feeds screen', () => {
  it('explains Feeds and offers to add a source when nothing is followed', async () => {
    mockSources = [];
    mockArticles = [];
    await render(<ReadingScreen />);
    expect(await screen.findByText(READING_ABOUT)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add a source' }));
    expect(mockPush).toHaveBeenCalledWith('/feeds/add');
    expect(mockSeen).toHaveBeenCalled();
  });

  it('lists articles with chips, and opening one reads it on its own site', async () => {
    mockSources = [source('s1', 'Stratechery')];
    mockArticles = [article('a1', 'The AI Unbundling'), article('a2', 'Old news', true)];
    await render(<ReadingScreen />);
    expect(await screen.findByText('The AI Unbundling')).toBeTruthy();
    expect(screen.getByText('About The AI Unbundling')).toBeTruthy();
    for (const chip of ['All', 'Unread', 'Stratechery']) expect(screen.getByRole('button', { name: chip })).toBeTruthy();

    await fireEvent.press(screen.getByRole('link', { name: /The AI Unbundling, Stratechery, 1h, unread/ }));
    expect(mockOpen).toHaveBeenCalledWith('https://stratechery.example/a1', expect.objectContaining({ dismissButtonStyle: 'close' }));
    expect(mockSetRead).toHaveBeenCalledWith('a1', true);
    // Already read: opening doesn't mark it again.
    await fireEvent.press(screen.getByRole('link', { name: /Old news/ }));
    expect(mockSetRead).toHaveBeenCalledTimes(1);
  });

  it('an article with more to read opens in Circlo; a headline only opens on its site', async () => {
    mockSources = [source('s1', 'Stratechery')];
    mockArticles = [article('a1', 'Long read', false, true), article('a2', 'Just a link')];
    await render(<ReadingScreen />);
    await fireEvent.press(await screen.findByRole('link', { name: /Long read/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/feeds/[id]', params: { id: 'a1' } });
    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockSetRead).toHaveBeenCalledWith('a1', true);
    await fireEvent.press(screen.getByRole('link', { name: /Just a link/ }));
    expect(mockOpen).toHaveBeenCalledWith('https://stratechery.example/a2', expect.anything());
  });

  it('the article menu can mark it unread', async () => {
    mockSources = [source('s1', 'Stratechery')];
    mockArticles = [article('a2', 'Old news', true)];
    await render(<ReadingScreen />);
    await screen.findByText('Old news');
    await fireEvent.press(screen.getAllByRole('button', { name: 'More' }).at(-1)!);
    expect(screen.getByText('Send in a chat')).toBeTruthy();
    expect(screen.getByText('Copy link')).toBeTruthy();
    await fireEvent.press(screen.getByText('Mark as unread'));
    expect(mockSetRead).toHaveBeenCalledWith('a2', false);
  });

  it('has no ⋯ menu until something is followed', async () => {
    mockSources = [];
    mockArticles = [];
    await render(<WithHeader><ReadingScreen /></WithHeader>);
    await screen.findByText(READING_ABOUT);
    expect(screen.getAllByRole('button', { name: 'Add a source' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('offers Mark all as read only while something is unread', async () => {
    mockSources = [source('s1', 'Stratechery', { unread: 1 })];
    mockArticles = [article('a1', 'The AI Unbundling')];
    await render(<WithHeader><ReadingScreen /></WithHeader>);
    await screen.findByText('The AI Unbundling');
    await fireEvent.press(screen.getByTestId('header-more'));
    expect(screen.getByText('Mark all as read')).toBeTruthy();
    expect(screen.getByText('Manage sources')).toBeTruthy();
  });

  it('leaves Mark all as read out once everything is read', async () => {
    mockSources = [source('s1', 'Stratechery', { unread: 0 })];
    mockArticles = [article('a1', 'The AI Unbundling', true)];
    await render(<WithHeader><ReadingScreen /></WithHeader>);
    await screen.findByText('The AI Unbundling');
    await fireEvent.press(screen.getByTestId('header-more'));
    expect(screen.getByText('Manage sources')).toBeTruthy();
    expect(screen.queryByText('Mark all as read')).toBeNull();
  });

  it('says when everything is read', async () => {
    mockSources = [source('s1', 'Stratechery')];
    mockArticles = [];
    await render(<ReadingScreen />);
    expect(await screen.findByText('Nothing yet')).toBeTruthy();
  });
});

describe('Reading an article in Circlo', () => {
  it('shows the feed’s text with its formatting and pictures, then a button to the original', async () => {
    mockParams = { id: 'a1' };
    mockDetail = {
      article: { ...article('a1', 'DD416 / Adrift in a world of options', false, true), url: 'https://www.densediscovery.com/issues/416', sourceTitle: 'Dense Discovery' },
      content: [
        { type: 'p', runs: [{ text: 'I left ' }, { text: 'Germany', b: true }, { text: ' at 20. See ' }, { text: 'a person of place', href: 'https://www.densediscovery.com/issues/352' }, { text: '.' }] },
        { type: 'h', runs: [{ text: 'Reading list' }] },
        { type: 'list', ordered: false, items: [[{ text: 'One' }], [{ text: 'Two' }]] },
        { type: 'quote', runs: [{ text: 'Quoted words.' }] },
        { type: 'img', src: '/v1/reading/image?u=x&e=1&s=y', alt: 'A photo', w: 800, h: 600 },
        { type: 'p', runs: [{ text: 'سندھی ٻولي' }] },
      ],
    };
    await render(<ArticleScreen />);
    expect(await screen.findByText('DD416 / Adrift in a world of options')).toBeTruthy();
    expect(screen.getByText('Germany')).toBeTruthy();
    expect(screen.getByText('Reading list')).toBeTruthy();
    expect(screen.getByText('Two')).toBeTruthy();
    expect(screen.getByText('Quoted words.')).toBeTruthy();
    expect(screen.getByTestId('article-image').props.source).toEqual({ uri: expect.stringMatching(/\/v1\/reading\/image\?u=x&e=1&s=y$/) });
    // Opening it reads it.
    expect(mockSetRead).toHaveBeenCalledWith('a1', true);

    await fireEvent.press(screen.getByRole('link', { name: 'a person of place' }));
    expect(mockOpen).toHaveBeenCalledWith('https://www.densediscovery.com/issues/352', expect.anything());
    await fireEvent.press(screen.getByRole('button', { name: 'Read on densediscovery.com ↗' }));
    expect(mockOpen).toHaveBeenLastCalledWith('https://www.densediscovery.com/issues/416', expect.anything());
  });

  it('says so when the article has gone', async () => {
    mockParams = { id: 'gone' };
    mockDetail = null;
    await render(<ArticleScreen />);
    expect(await screen.findByText('Not here any more')).toBeTruthy();
  });
});

describe('Add a source', () => {
  it('says plainly when a site has no feed', async () => {
    await render(<AddSourceScreen />);
    await fireEvent.changeText(screen.getByLabelText('Site or feed address'), 'plain.example');
    await fireEvent.press(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText(/couldn’t find a feed on this site/)).toBeTruthy();
    expect(mockFind).toHaveBeenCalledWith('plain.example');
  });

  it('shows the feed and its latest articles, then follows it', async () => {
    mockFind.mockResolvedValueOnce({
      feedUrl: 'https://arstechnica.example/feed',
      title: 'Ars Technica',
      siteUrl: 'https://arstechnica.example/',
      following: false,
      articles: [{ title: 'Inside the new chip', publishedAt: new Date().toISOString() }],
    });
    await render(<AddSourceScreen />);
    expect(screen.getByText('Only you can see what you follow. Circlo checks your sources for you, so the sites don’t see you until you open an article.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Site or feed address'), 'arstechnica.example');
    await fireEvent.press(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText('Inside the new chip')).toBeTruthy();
    expect(screen.getByText('arstechnica.example')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() => expect(mockFollow).toHaveBeenCalledWith('https://arstechnica.example/feed'));
    expect(mockToast).toHaveBeenCalledWith('Following Ars Technica');
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('Manage sources', () => {
  it('lists sources with their site and when they were last read', async () => {
    mockSources = [source('s1', 'Stratechery'), source('s2', 'Broken blog', { updatedAt: null, failingSince: '2020-01-01T00:00:00Z' })];
    await render(<SourcesScreen />);
    expect(await screen.findByText('Stratechery')).toBeTruthy();
    expect(screen.getByText('s1.example · Updated 2h ago')).toBeTruthy();
    expect(screen.getByText(/s2.example · Couldn’t update since/)).toBeTruthy();
    expect(screen.getByText('Only you can see what you follow.')).toBeTruthy();
  });
});
