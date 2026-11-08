import { render, screen } from '@testing-library/react-native';

import StorageScreen from '@/app/settings/storage';
import { formatBytes } from '@/lib/storage-usage';

const mockUsage = { usedBytes: 1_234_000_000, photoBytes: 834_000_000, videoBytes: 399_700_000, profilePhotoBytes: 300_000, photos: 1204, videos: 23 };
jest.mock('@/lib/storage-usage', () => ({
  ...jest.requireActual('@/lib/storage-usage'),
  fetchStorage: jest.fn(async () => mockUsage),
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return { useFocusEffect: (fn: () => void) => React.useEffect(fn, [fn]) };
});

describe('storage used', () => {
  it('shows sizes the way phones do', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(300_000)).toBe('300 KB');
    expect(formatBytes(4_560_000)).toBe('4.6 MB');
    expect(formatBytes(399_700_000)).toBe('400 MB');
    expect(formatBytes(1_234_000_000)).toBe('1.2 GB');
    expect(formatBytes(2_500_000_000_000)).toBe('2.5 TB');
  });

  it('shows the total, and what it is made of', async () => {
    await render(<StorageScreen />);
    expect(await screen.findByText('1.2 GB')).toBeTruthy();
    expect(screen.getByText('1,204 photos')).toBeTruthy();
    expect(screen.getByText('834 MB')).toBeTruthy();
    expect(screen.getByText('23 videos')).toBeTruthy();
    expect(screen.getByText('400 MB')).toBeTruthy();
    expect(screen.getByText('Profile photo')).toBeTruthy();
    expect(screen.getByText('300 KB')).toBeTruthy();
    // Other people's photos and videos don't count.
    expect(screen.getByText(/other people share with you don’t use your space/)).toBeTruthy();
  });
});
