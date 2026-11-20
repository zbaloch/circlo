import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { PasteImageButton } from '@/components/paste-image';
import { addPasted } from '@/lib/paste-logic';
import { imagesInPaste } from '@/lib/paste.web';

const mockHas = jest.fn(async () => true);
const mockRead = jest.fn();
jest.mock('@/lib/paste', () => ({
  clipboardHasImage: () => mockHas(),
  readClipboardImage: () => mockRead(),
  savePasted: jest.fn(),
  usePastedImages: jest.fn(),
}));
jest.mock('expo-router', () => ({ useFocusEffect: (cb: () => void) => jest.requireActual('react').useEffect(cb, [cb]) }));
jest.mock('expo-clipboard', () => {
  const { Text } = jest.requireActual('react-native');
  return { isPasteButtonAvailable: true, ClipboardPasteButton: (p: { accessibilityLabel: string }) => <Text>{`Apple ${p.accessibilityLabel}`}</Text> };
});

const shot = (n: number) => ({ uri: `file:///cache/${n}.png`, type: 'image' as const, width: 10, height: 10 });

describe('pasting a copied image', () => {
  beforeEach(() => mockRead.mockClear());
  afterEach(() => jest.restoreAllMocks());

  it('adds pasted photos up to the limit, and none beside a video', () => {
    expect(addPasted([shot(1)], [shot(2), shot(3)], 4)).toEqual({ media: [shot(1), shot(2), shot(3)], dropped: [] });
    expect(addPasted([shot(1), shot(2), shot(3)], [shot(4), shot(5)], 4)).toEqual({ media: [shot(1), shot(2), shot(3), shot(4)], dropped: [shot(5)] });
    const video = { uri: 'v', type: 'video' as const, width: 1, height: 1 };
    expect(addPasted([video], [shot(1)], 4)).toEqual({ media: [video], dropped: [shot(1)] });
  });

  it('on the web, takes only images from a paste, and notices text alongside', () => {
    const png = { type: 'image/png' } as File;
    const pdf = { type: 'application/pdf' } as File;
    expect(imagesInPaste({ files: [png, pdf] as unknown as FileList, types: ['Files'] })).toEqual({ files: [png], hasText: false });
    expect(imagesInPaste({ files: [png] as unknown as FileList, types: ['text/plain', 'Files'] }).hasText).toBe(true);
    expect(imagesInPaste(null)).toEqual({ files: [], hasText: false });
  });

  it('Android: a Paste button while the clipboard holds an image; tapping it reads the image', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onImages = jest.fn();
    mockRead.mockResolvedValue(shot(1));
    await render(<PasteImageButton onImages={onImages} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Paste image' }));
    expect(onImages).toHaveBeenCalledWith([shot(1)]);
  });

  it('nothing to paste: no button, and the clipboard isn’t read', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockHas.mockResolvedValueOnce(false);
    await render(<PasteImageButton onImages={jest.fn()} />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Paste image' })).toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('iPhone: Apple’s own Paste button, so there’s no “Allow Paste?” prompt', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await render(<PasteImageButton onImages={jest.fn()} />);
    expect(await screen.findByText('Apple Paste image')).toBeTruthy();
    expect(mockRead).not.toHaveBeenCalled();
  });
});
