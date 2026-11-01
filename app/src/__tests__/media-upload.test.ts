import { upload, uploadAvatar, type PreparedItem } from '@/lib/media';

// Presigned PUTs are signed for the declared Content-Type; expo-file-system ignores `mimeType` for binary uploads,
// so the header must be sent explicitly or storage answers 403.
const mockUpload = jest.fn(async () => ({ status: 200, body: '', headers: {} }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  FileMode: { ReadWrite: 'rw' },
  Directory: jest.fn(() => ({ exists: true, create: jest.fn() })),
  File: jest.fn(() => ({
    size: 5,
    exists: true,
    delete: jest.fn(),
    write: jest.fn(),
    bytes: jest.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    upload: mockUpload,
  })),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: jest.fn(),
      renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file:///cache/x.jpg', width: 10, height: 10 }) }),
    }),
  },
}));
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
jest.mock('@/api/client', () => ({
  api: {
    POST: jest.fn(async (_path: string, { body }: { body: { files: { size: number; mime: string }[] } }) => ({
      data: body.files.map((f, i) => ({ objectKey: `k${i}`, putUrl: `https://s3.example/b/k${i}?sig`, size: f.size, mime: f.mime })),
    })),
  },
  ok: (r: { data: unknown }) => r.data,
}));

const file = (mime: string) => {
  const { File } = jest.requireMock('expo-file-system');
  return { file: new File(), mime, width: 10, height: 10 };
};

beforeEach(() => mockUpload.mockClear());

test('post uploads send the signed Content-Type header', async () => {
  const items: PreparedItem[] = [{ type: 'video', full: file('video/mp4'), preview: file('image/jpeg'), durationMs: 1000 }];
  await upload(items);
  expect(mockUpload.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
    expect.objectContaining({ httpMethod: 'PUT', headers: { 'Content-Type': 'video/mp4' } }),
    expect.objectContaining({ httpMethod: 'PUT', headers: { 'Content-Type': 'image/jpeg' } }),
  ]);
});

test('avatar upload sends the signed Content-Type header', async () => {
  await uploadAvatar({ uri: 'file:///cache/p.jpg', type: 'image', width: 10, height: 10 });
  expect(mockUpload).toHaveBeenCalledWith('https://s3.example/b/k0?sig', expect.objectContaining({ headers: { 'Content-Type': 'image/jpeg' } }));
});
