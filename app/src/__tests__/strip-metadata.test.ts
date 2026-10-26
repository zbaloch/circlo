import { jpegHasMetadata, neutralizeMp4Metadata, stripJpegMetadata, type BoxIO } from '@/lib/strip-metadata';

const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

describe('JPEG metadata stripping', () => {
  const app0 = seg(0xe0, [...ascii('JFIF'), 0, 1, 1]);
  const exif = seg(0xe1, [...ascii('Exif'), 0, 0, ...ascii('GPS 51.5N 0.12W')]);
  const iptc = seg(0xed, ascii('Photoshop 3.0 Place: Home'));
  const comment = seg(0xfe, ascii('taken at my house'));
  const dqt = seg(0xdb, [0, ...new Array(64).fill(1)]);
  const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34, 0x56, 0xff, 0xd9];
  const jpeg = Uint8Array.from([0xff, 0xd8, ...app0, ...exif, ...iptc, ...comment, ...dqt, ...sos]);

  it('removes EXIF/GPS, IPTC and comments but keeps image segments and data', () => {
    expect(jpegHasMetadata(jpeg)).toBe(true);
    const out = stripJpegMetadata(jpeg);
    expect(jpegHasMetadata(out)).toBe(false);
    const text = String.fromCharCode(...out);
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('Place');
    expect(text).not.toContain('house');
    expect(text).toContain('JFIF');
    expect(Array.from(out.slice(-sos.length))).toEqual(sos);
    expect(out.length).toBe(jpeg.length - exif.length - iptc.length - comment.length);
  });

  it('rejects non-JPEG and truncated input', () => {
    expect(() => stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toThrow();
    expect(() => stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toThrow();
  });
});

describe('MP4 metadata neutralizing', () => {
  const box = (type: string, body: number[]) => {
    const size = body.length + 8;
    return [(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, ...ascii(type), ...body];
  };
  const memIO = (bytes: Uint8Array): BoxIO => ({
    size: () => bytes.length,
    read: (o, l) => bytes.slice(o, o + l),
    write: (o, b) => bytes.set(b, o),
  });

  it('renames udta/meta in moov and tracks to free without changing sizes or offsets', () => {
    const file = Uint8Array.from([
      ...box('ftyp', ascii('isom')),
      ...box('moov', [
        ...box('mvhd', new Array(20).fill(0)),
        ...box('udta', box('©xyz', ascii('+51.5074-000.1278/'))),
        ...box('meta', ascii('com.apple.quicktime.location.ISO6709')),
        ...box('trak', [...box('tkhd', new Array(12).fill(0)), ...box('udta', ascii('device: Phone X'))]),
      ]),
      ...box('mdat', new Array(32).fill(7)),
    ]);
    const before = file.length;
    const n = neutralizeMp4Metadata(memIO(file));
    expect(n).toBe(3);
    expect(file.length).toBe(before);
    const text = String.fromCharCode(...file);
    expect(text).not.toContain('udta');
    expect(text).not.toMatch(/meta(?!data)/);
    expect(text.split('free').length - 1).toBe(3);
    expect(text).toContain('mdat');
    // The payload is wiped too: a 'free' box still holds bytes, and friends who decrypt the video could read them.
    expect(text).not.toContain('51.5074');
    expect(text).not.toContain('location');
    expect(text).not.toContain('Phone X');
  });

  it('rejects malformed box sizes', () => {
    const bad = Uint8Array.from([0, 0, 0, 200, ...ascii('moov'), 0, 0, 0, 0]);
    expect(() => neutralizeMp4Metadata(memIO(bad))).toThrow();
  });
});
