import { render, screen } from '@testing-library/react-native';

import { MediaGrid, singlePhotoShape } from '@/components/post-media';
import type { Attachment } from '@/lib/media';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-image', () => {
  const { View } = jest.requireActual('react-native');
  return { Image: (props: { className?: string }) => <View testID="photo" {...props} /> };
});

const photo = (width: number, height: number, key = 'k'): Attachment =>
  ({ type: 'image', mime: 'image/jpeg', width, height, durationMs: 0, objectKey: key, url: `https://m.test/${key}`, previewKey: `${key}p`, previewUrl: `https://m.test/${key}p` }) as Attachment;

describe('a post’s only photo, as on Bluesky', () => {
  it('keeps its own shape: wide ones fill the width, tall ones are narrower', () => {
    expect(singlePhotoShape(4000, 3000)).toEqual({ tall: false, className: 'aspect-[4/3]' });
    expect(singlePhotoShape(1920, 1080)).toEqual({ tall: false, className: 'aspect-video' });
    expect(singlePhotoShape(1000, 1000)).toEqual({ tall: false, className: 'aspect-square' });
    expect(singlePhotoShape(3000, 4000)).toEqual({ tall: true, className: 'aspect-[3/4]' });
    expect(singlePhotoShape(1080, 1920)).toEqual({ tall: true, className: 'aspect-[9/16]' });
    // Phone screenshots and panoramas stop at 1:2 and 3:1.
    expect(singlePhotoShape(1080, 2400).className).toBe('aspect-[1/2]');
    expect(singlePhotoShape(6000, 1000).className).toBe('aspect-[3/1]');
    // Size unknown: 4:3, as before.
    expect(singlePhotoShape(0, 0)).toEqual({ tall: false, className: 'aspect-[4/3]' });
  });

  it('a tall photo sits in a square-high box, on the left; a wide one fills the width', async () => {
    await render(<MediaGrid media={[photo(3000, 4000)]} />);
    const tall = screen.getByRole('imagebutton', { name: 'Photo 1 of 1' });
    expect(tall.props.className).toContain('aspect-[3/4]');
    expect(tall.props.className).toContain('h-full');
    expect(tall.props.className).not.toContain('w-full');
    await render(<MediaGrid media={[photo(4000, 3000)]} />);
    expect(screen.getByRole('imagebutton', { name: 'Photo 1 of 1' }).props.className).toContain('w-full aspect-[4/3]');
  });

  it('two or more photos keep the grid', async () => {
    await render(<MediaGrid media={[photo(3000, 4000, 'a'), photo(4000, 3000, 'b')]} />);
    expect(screen.getAllByRole('imagebutton')).toHaveLength(2);
    expect(screen.getByRole('imagebutton', { name: 'Photo 1 of 2' }).props.className).toBe('flex-1');
  });
});
