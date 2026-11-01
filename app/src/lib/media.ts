/**
 * Photos and videos (PLAN.md Phase 7). Before anything leaves the phone:
 * - photos are re-encoded (2048 px full + 480 px thumbnail) and their EXIF/GPS/IPTC segments removed;
 * - videos keep their frames but lose location/device metadata boxes, and get a re-encoded poster frame;
 * - each file goes straight to storage with a presigned PUT locked to its size and type.
 * The web app uses media.web.ts.
 */
import { Directory, File, FileMode, Paths, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

import { jpegHasMetadata, neutralizeMp4Metadata, stripJpegMetadata, type BoxIO } from './strip-metadata';

export const MAX_IMAGES = 4;
export const MAX_VIDEOS = 1;
const FULL_EDGE = 2048;
const THUMB_EDGE = 480;
const POSTER_EDGE = 1280;

/** A photo or video as readers get it: download URLs from the server. */
export type Attachment = components['schemas']['Attachment'];
/** A photo or video to attach to a new post or message (both files already uploaded). */
export type NewAttachment = components['schemas']['NewAttachment'];

/** What the picker gave us. */
export type PickedMedia = { uri: string; type: 'image' | 'video'; width: number; height: number; durationMs?: number; mimeType?: string };

type Prepared = { file: File; mime: string; width: number; height: number };

/** One picked item, ready to upload: the photo and its thumbnail, or the video and its poster frame. */
export type PreparedItem = { type: 'image' | 'video'; full: Prepared; preview: Prepared; durationMs: number };

function workDir(name: string): Directory {
  const dir = new Directory(Paths.cache, name);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const tmpName = (ext: string) => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.${ext}`;

/** Re-encodes to JPEG at most `edge` px on the long side, then removes any metadata segment left by the encoder. */
async function reencodeJpeg(uri: string, width: number, height: number, edge: number, compress: number): Promise<Prepared> {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > edge) ctx.resize(width >= height ? { width: edge, height: null } : { width: null, height: edge });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress });
  const encoded = new File(saved.uri);
  const clean = stripJpegMetadata(await encoded.bytes());
  if (jpegHasMetadata(clean)) throw new Error('metadata removal failed');
  const out = new File(workDir('outbox'), tmpName('jpg'));
  await out.write(clean);
  encoded.delete();
  return { file: out, mime: 'image/jpeg', width: saved.width, height: saved.height };
}

function fileIO(file: File): { io: BoxIO; close: () => void } {
  const handle = file.open(FileMode.ReadWrite);
  return {
    io: {
      size: () => file.size,
      read: (offset, length) => {
        handle.offset = offset;
        return handle.readBytesSync(Math.min(length, file.size - offset));
      },
      write: (offset, bytes) => {
        handle.offset = offset;
        handle.writeBytesSync(bytes);
      },
    },
    close: () => handle.close(),
  };
}

/** Turns one picked item into the files to upload, with their metadata removed. */
export async function prepare(media: PickedMedia): Promise<PreparedItem> {
  if (media.type === 'image') {
    const full = await reencodeJpeg(media.uri, media.width, media.height, FULL_EDGE, 0.85);
    const preview = await reencodeJpeg(media.uri, media.width, media.height, THUMB_EDGE, 0.7);
    return { type: 'image', full, preview, durationMs: 0 };
  }
  const mime = media.mimeType === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  if (media.mimeType && !/^video\/(mp4|quicktime)$/.test(media.mimeType)) throw new Error('Only MP4 and MOV videos are supported.');
  const copy = new File(workDir('outbox'), tmpName(mime === 'video/mp4' ? 'mp4' : 'mov'));
  await new File(media.uri).copy(copy);
  const { io, close } = fileIO(copy);
  try {
    neutralizeMp4Metadata(io);
  } finally {
    close();
  }
  const frame = await getThumbnailAsync(media.uri, { time: 0, quality: 0.9 });
  const poster = await reencodeJpeg(frame.uri, frame.width, frame.height, POSTER_EDGE, 0.8);
  new File(frame.uri).delete();
  return { type: 'video', full: { file: copy, mime, width: media.width, height: media.height }, preview: poster, durationMs: Math.round(media.durationMs ?? 0) };
}

/** Uploads prepared items. `onProgress` gets 0..1 over the total size. */
export async function upload(items: PreparedItem[], onProgress?: (fraction: number) => void): Promise<NewAttachment[]> {
  if (items.length === 0) return [];
  const files = items.flatMap((i) => [i.full, i.preview]);
  const slots = ok(await api.POST('/v1/media/uploads', { body: { files: files.map((f) => ({ size: f.file.size, mime: f.mime as never })) } }));
  const total = files.reduce((a, f) => a + f.file.size, 0);
  let done = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const slot = slots[i];
    if (!slot || slot.size !== f.file.size) throw new Error('bad upload slot');
    const res = await f.file.upload(slot.putUrl, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: f.mime,
      onProgress: ({ bytesSent }) => onProgress?.((done + bytesSent) / total),
    });
    if (res.status !== 200) throw new Error(`upload failed (${res.status})`);
    done += f.file.size;
    onProgress?.(done / total);
  }
  return items.map((item, i) => ({
    type: item.type,
    objectKey: slots[2 * i].objectKey,
    previewKey: slots[2 * i + 1].objectKey,
    width: item.full.width,
    height: item.full.height,
    durationMs: item.durationMs,
  }));
}

/** Uploads one photo for my profile (a square-ish 1024 px JPEG without metadata); returns its object key. */
export async function uploadAvatar(media: PickedMedia): Promise<string> {
  const photo = await reencodeJpeg(media.uri, media.width, media.height, 1024, 0.85);
  try {
    const [slot] = ok(await api.POST('/v1/media/uploads', { body: { files: [{ size: photo.file.size, mime: 'image/jpeg' }] } }));
    const res = await photo.file.upload(slot.putUrl, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, mimeType: 'image/jpeg' });
    if (res.status !== 200) throw new Error(`upload failed (${res.status})`);
    return slot.objectKey;
  } finally {
    if (photo.file.exists) photo.file.delete();
  }
}

export function discardPrepared(items: PreparedItem[]) {
  for (const i of items) for (const f of [i.full.file, i.preview.file]) if (f.exists) f.delete();
}

/**
 * Deletes the picker's private copies of the originals (they still carry EXIF/GPS). Only files inside the app cache
 * are touched; the user's gallery is never modified.
 */
export function discardPicked(media: PickedMedia[]) {
  for (const m of media) {
    try {
      if (!m.uri.startsWith(Paths.cache.uri)) continue;
      const f = new File(m.uri);
      if (f.exists) f.delete();
    } catch {
      // already gone
    }
  }
}

/** Removes picked, prepared and cached media files, including the media libraries' own caches (sign-out). */
export function clearMediaCache() {
  for (const name of ['outbox', 'ImagePicker', 'ImageManipulator', 'VideoThumbnails', 'ExpoVideoCache']) {
    const dir = new Directory(Paths.cache, name);
    if (dir.exists) dir.delete();
  }
}
