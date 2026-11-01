import { act, renderHook } from '@testing-library/react-native';

import { hideToast, pressToastAction, showToast, TOAST_MS, useToast } from '@/lib/toast';

describe('toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(async () => {
    await act(() => hideToast());
    jest.useRealTimers();
  });

  it('shows one toast at a time and hides it after a few seconds', async () => {
    const { result } = await renderHook(() => useToast());
    await act(() => showToast('First'));
    await act(() => jest.advanceTimersByTime(TOAST_MS - 1000));
    await act(() => showToast('Reply sent'));
    expect(result.current?.message).toBe('Reply sent');
    // The newer toast gets its own full time on screen.
    await act(() => jest.advanceTimersByTime(TOAST_MS - 1));
    expect(result.current).not.toBeNull();
    await act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it('its action hides it and runs', async () => {
    const onPress = jest.fn();
    const { result } = await renderHook(() => useToast());
    await act(() => showToast('Reply sent', { text: 'View', onPress }));
    await act(() => pressToastAction(result.current!));
    expect(onPress).toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
