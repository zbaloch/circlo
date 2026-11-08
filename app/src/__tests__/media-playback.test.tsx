import { act, fireEvent, render, screen } from '@testing-library/react-native';

import VideoScreen from '@/app/video';
import { MediaGrid } from '@/components/post-media';
import { formatTime, openedVideo, openVideo, rememberMuted, timeAt } from '@/lib/video';
import { clampPan, doubleTapScale, MAX_ZOOM } from '@/lib/zoom';

// A stand-in for expo-video's player: records what the viewer asks of it, and lets a test send its events.
type Listener = (payload?: unknown) => void;
type FakePlayer = {
  currentTime: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  status: string;
  timeUpdateEventInterval: number;
  play: jest.Mock;
  pause: jest.Mock;
  replay: jest.Mock;
  emit: (event: string, payload?: unknown) => void;
};
const mockPlayers: FakePlayer[] = [];
jest.mock('expo-video', () => {
  const React = jest.requireActual('react');
  return {
    useVideoPlayer: (_source: string, setup?: (p: unknown) => void) => {
      const ref = React.useRef(null);
      if (!ref.current) {
        const listeners: Record<string, Listener[]> = {};
        const p = {
          currentTime: 0,
          duration: 0,
          playing: false,
          muted: false,
          status: 'loading',
          timeUpdateEventInterval: 0,
          play: jest.fn(() => {
            p.playing = true;
            p.emit('playingChange', { isPlaying: true });
          }),
          pause: jest.fn(() => {
            p.playing = false;
            p.emit('playingChange', { isPlaying: false });
          }),
          replay: jest.fn(() => {
            p.currentTime = 0;
            p.play();
          }),
          emit: (event: string, payload?: unknown) => (listeners[event] ?? []).forEach((l) => l(payload)),
          addListener: (event: string, l: Listener) => {
            (listeners[event] ??= []).push(l);
            return { remove: () => listeners[event].splice(listeners[event].indexOf(l), 1) };
          },
        };
        setup?.(p);
        mockPlayers.push(p);
        ref.current = p;
      }
      return ref.current;
    },
    VideoView: () => null,
  };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
const mockRouter: { push: jest.Mock; back: jest.Mock } = jest.requireMock('expo-router').router;

const video = { type: 'video' as const, mime: 'video/mp4', width: 1280, height: 720, durationMs: 10_000, objectKey: 'v1', url: 'https://m.test/v1', previewKey: 'p1', previewUrl: 'https://m.test/p1' };
const player = () => mockPlayers[mockPlayers.length - 1];

beforeEach(() => {
  mockPlayers.length = 0;
  mockRouter.push.mockClear();
  mockRouter.back.mockClear();
  rememberMuted(false);
  openVideo(null);
});

describe('video helpers', () => {
  it('shows times as a clock', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(7.6)).toBe('0:07');
    expect(formatTime(62)).toBe('1:02');
    expect(formatTime(3723)).toBe('1:02:03');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });

  it('finds the time under a finger on the progress bar', () => {
    expect(timeAt(50, 200, 10)).toBe(2.5);
    expect(timeAt(-20, 200, 10)).toBe(0);
    expect(timeAt(260, 200, 10)).toBe(10);
    expect(timeAt(50, 0, 10)).toBe(0);
  });
});

describe('a video in a post or chat', () => {
  it('shows the poster and its length; tapping opens the full-screen viewer', async () => {
    await render(<MediaGrid media={[video]} />);
    expect(screen.getByText('0:10')).toBeTruthy();
    // Nothing plays in the timeline.
    expect(mockPlayers).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Play video' }));
    expect(openedVideo()).toBe(video);
    expect(mockRouter.push).toHaveBeenCalledWith('/video');
  });
});

describe('the full-screen video viewer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const open = async () => {
    openVideo(video);
    return render(<VideoScreen />);
  };
  const controls = () => screen.getByTestId('video-controls');
  const ready = () =>
    act(() => {
      player().duration = 10;
      player().status = 'readyToPlay';
      player().emit('statusChange', { status: 'readyToPlay' });
    });

  it('plays straight away, with a spinner until it is ready', async () => {
    await open();
    expect(player().play).toHaveBeenCalled();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    await ready();
    expect(screen.queryByLabelText('Loading')).toBeNull();
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByText('0:10')).toBeTruthy();
  });

  it('pauses and plays with the big button, and shows the time as it plays', async () => {
    await open();
    await ready();
    await act(() => player().emit('timeUpdate', { currentTime: 4.2 }));
    expect(screen.getByText('0:04')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(player().pause).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Play' }));
    expect(player().play).toHaveBeenCalledTimes(2);
  });

  it('fades the controls while playing; a tap brings them back; they stay while paused', async () => {
    await open();
    await ready();
    expect(controls().props.pointerEvents).toBe('box-none');
    await act(() => jest.advanceTimersByTime(3000));
    expect(controls().props.pointerEvents).toBe('none');
    // Tap the video.
    const area = screen.getByTestId('video-area');
    await act(() => {
      fireEvent(area, 'responderGrant', { nativeEvent: { pageX: 100, pageY: 100 } });
      fireEvent(area, 'responderRelease', { nativeEvent: { pageX: 101, pageY: 101 } });
    });
    expect(controls().props.pointerEvents).toBe('box-none');
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    await act(() => jest.advanceTimersByTime(5000));
    expect(controls().props.pointerEvents).toBe('box-none');
  });

  it('seeks where the progress bar is touched', async () => {
    await open();
    await ready();
    const bar = screen.getByTestId('video-seek');
    await act(() => {
      fireEvent(bar, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 24 } } });
      fireEvent(bar, 'responderGrant', { nativeEvent: { locationX: 50, pageX: 66 } });
      fireEvent(bar, 'responderMove', { nativeEvent: { locationX: 0, pageX: 116 } });
      fireEvent(bar, 'responderRelease', { nativeEvent: { locationX: 0, pageX: 116 } });
    });
    // Touched at 50 of 200, dragged 50 further: halfway.
    expect(player().currentTime).toBe(5);
    expect(screen.getByText('0:05')).toBeTruthy();
  });

  it('mutes, and the next video starts muted too', async () => {
    const first = await open();
    expect(player().muted).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Mute' }));
    expect(player().muted).toBe(true);
    await act(async () => first.unmount());
    await open();
    expect(player().muted).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Sound on' }));
    expect(player().muted).toBe(false);
  });

  it('offers to play again at the end', async () => {
    await open();
    await ready();
    await act(() => {
      player().playing = false;
      player().emit('playingChange', { isPlaying: false });
      player().emit('playToEnd');
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Play again' }));
    expect(player().replay).toHaveBeenCalled();
  });

  it('closes with the close button, or a swipe down', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    const area = screen.getByTestId('video-area');
    await act(() => {
      fireEvent(area, 'responderGrant', { nativeEvent: { pageX: 100, pageY: 100 } });
      fireEvent(area, 'responderMove', { nativeEvent: { pageX: 100, pageY: 260 } });
      fireEvent(area, 'responderRelease', { nativeEvent: { pageX: 100, pageY: 260 } });
    });
    expect(mockRouter.back).toHaveBeenCalledTimes(2);
  });

  it('says so when the video can’t play', async () => {
    await open();
    await act(() => {
      player().status = 'error';
      player().emit('statusChange', { status: 'error' });
    });
    expect(screen.getByText('Couldn’t play this video.')).toBeTruthy();
  });

  it('goes back if there is no video to show', async () => {
    await render(<VideoScreen />);
    expect(mockRouter.back).toHaveBeenCalled();
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
