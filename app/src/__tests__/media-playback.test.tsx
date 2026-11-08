import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { VideoPlayer } from '@/components/post-media';
import { claim, nowPlaying, release, resetNowPlaying, setPlaying } from '@/lib/now-playing';
import { clampPan, doubleTapScale, MAX_ZOOM } from '@/lib/zoom';

// A stand-in for expo-video's player: records play/pause and the position, and lets a test press its own controls.
type FakePlayer = { currentTime: number; playing: boolean; play: jest.Mock; pause: jest.Mock; emit: (playing: boolean) => void };
const mockPlayers: FakePlayer[] = [];
jest.mock('expo-video', () => {
  const React = jest.requireActual('react');
  return {
    useVideoPlayer: () => {
      const ref = React.useRef(null);
      if (!ref.current) {
        const listeners: ((p: { isPlaying: boolean }) => void)[] = [];
        const p: FakePlayer & { addListener: unknown } = {
          currentTime: 0,
          playing: false,
          play: jest.fn(() => {
            p.playing = true;
            listeners.forEach((l) => l({ isPlaying: true }));
          }),
          pause: jest.fn(() => {
            p.playing = false;
            listeners.forEach((l) => l({ isPlaying: false }));
          }),
          emit: (playing: boolean) => (playing ? p.play() : p.pause()),
          addListener: (_: string, l: (x: { isPlaying: boolean }) => void) => {
            listeners.push(l);
            return { remove: () => listeners.splice(listeners.indexOf(l), 1) };
          },
        };
        mockPlayers.push(p);
        ref.current = p;
      }
      return ref.current;
    },
    VideoView: () => null,
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
// Each screen's focus is driven by the test: blur(screen) / focus(screen).
const mockFocus: Record<string, { on: Set<() => (() => void) | void>; offs: Map<() => unknown, () => void>; focused: boolean }> = {};
let mockScreen = 'home';
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (fn: () => (() => void) | void) => {
      const name = React.useRef(mockScreen).current;
      mockFocus[name] ??= { on: new Set(), offs: new Map(), focused: true };
      React.useEffect(() => {
        const s = mockFocus[name];
        s.on.add(fn);
        if (s.focused) {
          const off = fn();
          if (off) s.offs.set(fn, off);
        }
        return () => {
          s.on.delete(fn);
          s.offs.get(fn)?.();
          s.offs.delete(fn);
        };
      }, [fn, name]);
    },
  };
});
const blur = (name: string) =>
  act(async () => {
    const s = mockFocus[name];
    s.focused = false;
    s.offs.forEach((off) => off());
    s.offs.clear();
  });
const focus = (name: string) =>
  act(async () => {
    const s = mockFocus[name];
    s.focused = true;
    s.on.forEach((fn) => {
      const off = fn();
      if (off) s.offs.set(fn, off);
    });
  });

const video = { type: 'video' as const, mime: 'video/mp4', width: 1280, height: 720, durationMs: 30_000, objectKey: 'v1', url: 'https://m.test/v1', previewKey: 'p1', previewUrl: 'https://m.test/p1' };
const other = { ...video, objectKey: 'v2', url: 'https://m.test/v2' };

beforeEach(() => {
  resetNowPlaying();
  mockPlayers.length = 0;
  for (const k of Object.keys(mockFocus)) delete mockFocus[k];
  mockScreen = 'home';
});

describe('now playing: one video at a time, carried from screen to screen', () => {
  it('hands a playing video on, with its position', () => {
    claim('v1', 1);
    release('v1', 1, 12.5, true);
    expect(nowPlaying()).toEqual({ key: 'v1', owner: 0, time: 12.5, playing: true });
    claim('v1', 2);
    expect(nowPlaying()).toMatchObject({ owner: 2, time: 12.5 });
  });

  it('only the one showing it can pause it or hand it on', () => {
    claim('v1', 1);
    setPlaying('v1', 2, false);
    release('v1', 2, 3, false);
    expect(nowPlaying()).toMatchObject({ owner: 1, playing: true });
  });
});

describe('videos in posts', () => {
  const player = (i: number) => mockPlayers[i];

  it('opening the post: the same video carries on from where it was, in the post', async () => {
    const home = await render(<VideoPlayer video={video} className="" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Play video' }));
    expect(player(0).play).toHaveBeenCalled();
    player(0).currentTime = 7;

    // The post opens on top; Home loses focus.
    mockScreen = 'post';
    const post = await render(<VideoPlayer video={video} className="" />);
    await blur('home');
    expect(player(0).playing).toBe(false);
    expect(player(1).currentTime).toBe(7);
    expect(player(1).playing).toBe(true);
    // Just one is playing.
    expect(mockPlayers.filter((p) => p.playing)).toHaveLength(1);

    // Back to Home: it carries on from where the post got to, not from the start.
    player(1).currentTime = 15;
    await act(async () => post.unmount());
    await focus('home');
    expect(player(0).currentTime).toBe(15);
    expect(player(0).playing).toBe(true);
    await act(async () => home.unmount());
  });

  it('paused in the post stays paused back on Home, at the same place', async () => {
    await render(<VideoPlayer video={video} className="" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Play video' }));
    mockScreen = 'post';
    const post = await render(<VideoPlayer video={video} className="" />);
    await blur('home');
    player(1).currentTime = 20;
    await act(async () => player(1).emit(false));
    await act(async () => post.unmount());
    await focus('home');
    expect(player(0).currentTime).toBe(20);
    expect(player(0).playing).toBe(false);
  });

  it('starting another video pauses the first', async () => {
    await render(
      <>
        <VideoPlayer video={video} className="" />
        <VideoPlayer video={other} className="" />
      </>,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Play video' });
    await fireEvent.press(first);
    await fireEvent.press(second);
    expect(player(0).playing).toBe(false);
    expect(player(1).playing).toBe(true);
    // And pressing play on the first again pauses the second.
    await act(async () => player(0).emit(true));
    expect(player(1).playing).toBe(false);
  });
});

describe('zoomed photos', () => {
  it('pan stays inside the zoomed photo', () => {
    // At 2×, a 400-wide photo is 800 wide: it can move 200 each way.
    expect(clampPan(150, 2, 400)).toBe(150);
    expect(clampPan(500, 2, 400)).toBe(200);
    expect(clampPan(-500, 2, 400)).toBe(-200);
    expect(clampPan(80, 1, 400)).toBe(0);
  });

  it('double-tap zooms in, and back out', () => {
    expect(doubleTapScale(1)).toBe(2.5);
    expect(doubleTapScale(2.5)).toBe(1);
    expect(doubleTapScale(MAX_ZOOM)).toBe(1);
  });
});
