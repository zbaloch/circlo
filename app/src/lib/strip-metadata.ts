/**
 * Metadata removal before anything is encrypted and uploaded (PLAN.md Phase 7: "strip EXIF/GPS"). Byte-level and
 * dependency-free so it's testable and doesn't rely on undocumented behaviour of image/video libraries.
 */

const APP1 = 0xe1; // EXIF and XMP: camera, time, GPS location
const APP13 = 0xed; // IPTC / Photoshop: names, captions, places
const COM = 0xfe; // free-text comments

/** Returns a copy of the JPEG without APP1, APP13 and comment segments. Throws if the input isn't a JPEG. */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new Error('not a JPEG');
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= input.length) {
    if (input[i] !== 0xff) throw new Error('malformed JPEG');
    const marker = input[i + 1];
    if (marker === 0xd9) break; // EOI without image data
    if (marker === 0xda) {
      // Start of scan: the rest is entropy-coded image data (plus EOI); copy as is.
      for (let j = i; j < input.length; j++) out.push(input[j]);
      return Uint8Array.from(out);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    const len = (input[i + 2] << 8) | input[i + 3];
    if (len < 2 || i + 2 + len > input.length) throw new Error('malformed JPEG');
    if (marker !== APP1 && marker !== APP13 && marker !== COM) {
      for (let j = i; j < i + 2 + len; j++) out.push(input[j]);
    }
    i += 2 + len;
  }
  out.push(0xff, 0xd9);
  return Uint8Array.from(out);
}

/** True if any metadata segment remains (used as a final check before upload). */
export function jpegHasMetadata(input: Uint8Array): boolean {
  let i = 2;
  while (i + 4 <= input.length && input[i] === 0xff) {
    const marker = input[i + 1];
    if (marker === 0xda || marker === 0xd9) return false;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === APP1 || marker === APP13 || marker === COM) return true;
    i += 2 + ((input[i + 2] << 8) | input[i + 3]);
  }
  return false;
}

/** Random-access file I/O, so large videos are never loaded whole into memory. */
export interface BoxIO {
  size(): number;
  read(offset: number, length: number): Uint8Array;
  write(offset: number, bytes: Uint8Array): void;
}

const FREE = [0x66, 0x72, 0x65, 0x65]; // 'free'
const NEUTRALIZE = new Set(['udta', 'meta']); // user data / metadata: where phones store location and device info
const CONTAINERS = new Set(['moov', 'trak']);

function u32(b: Uint8Array, o: number) {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

function walk(io: BoxIO, start: number, end: number, depth: number, onBox: (type: string, offset: number, size: number, header: number) => void) {
  let offset = start;
  while (offset + 8 <= end) {
    const h = io.read(offset, 16);
    let size = u32(h, 0);
    const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    let header = 8;
    if (size === 1) {
      size = u32(h, 8) * 2 ** 32 + u32(h, 12);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) throw new Error('malformed MP4');
    onBox(type, offset, size, header);
    if (CONTAINERS.has(type) && depth < 2) walk(io, offset + header, offset + size, depth + 1, onBox);
    offset += size;
  }
}

const WIPE_CHUNK = 64 * 1024;

/**
 * Turns every `udta`/`meta` box inside `moov` and its tracks into a zero-filled `free` box, in place. Sizes and
 * offsets are unchanged, so the video still plays (players skip `free` boxes), and the location/device bytes are gone
 * rather than merely hidden. Returns how many boxes were neutralized.
 */
export function neutralizeMp4Metadata(io: BoxIO): number {
  const found: { offset: number; size: number; header: number }[] = [];
  walk(io, 0, io.size(), 0, (type, offset, size, header) => {
    if (NEUTRALIZE.has(type)) found.push({ offset, size, header });
  });
  for (const box of found) {
    io.write(box.offset + 4, Uint8Array.from(FREE));
    for (let at = box.offset + box.header; at < box.offset + box.size; at += WIPE_CHUNK) {
      io.write(at, new Uint8Array(Math.min(WIPE_CHUNK, box.offset + box.size - at)));
    }
  }
  return found.length;
}
