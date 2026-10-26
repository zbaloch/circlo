/**
 * The on-device media pipeline (PLAN.md Phase 7). Before anything leaves the phone:
 * - photos are re-encoded (2048 px full + 480 px thumbnail) and their EXIF/GPS/IPTC segments removed;
 * - videos keep their frames but lose location/device metadata boxes, and get a re-encoded poster frame;
 * - every file is encrypted by the core (chunked, Padmé-padded) under its own random key, bound to a random object key;
 * - the ciphertext is uploaded with a PUT URL locked to its exact size.
 * Reading reverses it: download ciphertext, decrypt in the core to a private cache file (images), or stream through
 * the core's loopback player (video). No crypto is implemented here.
 */
import * as Core from '@halqo/core';
import { Directory, File, FileMode, Paths, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import { api, ok } from '@/api/client';

import { equalBytes } from './bytes';
import { jpegHasMetadata, neutralizeMp4Metadata, stripJpegMetadata, type BoxIO } from './strip-metadata';

export const MAX_IMAGES = 4;
export const MAX_VIDEOS = 1;
const FULL_EDGE = 2048;
const THUMB_EDGE = 480;
const POSTER_EDGE = 1280;

export type MediaKind = 'full' | 'thumb' | 'poster';
const KIND_CODE: Record<MediaKind, number> = { full: 0, thumb: 1, poster: 2 };
export const kindName = (code: number): MediaKind => (code === 2 ? 'poster' : code === 1 ? 'thumb' : 'full');

/** What the picker gave us. */
export type PickedMedia = { uri: string; type: 'image' | 'video'; width: number; height: number; durationMs?: number; mimeType?: string };

type Prepared = { file: File; kind: MediaKind; mime: string; width: number; height: number; durationMs: number };

export type UploadedMedia = { objectKey: string; kind: MediaKind; item: Core.MediaItem };

/** Core file APIs take filesystem paths, not URIs. */
export function pathOf(file: File): string {
  return decodeURIComponent(file.uri.replace(/^file:\/\//, ''));
}

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
  return { file: out, kind: 'full', mime: 'image/jpeg', width: saved.width, height: saved.height, durationMs: 0 };
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

/** Turns one picked item into the plaintext files to encrypt: [full, thumb] for photos, [full, poster] for videos. */
export async function prepare(media: PickedMedia): Promise<Prepared[]> {
  if (media.type === 'image') {
    const full = await reencodeJpeg(media.uri, media.width, media.height, FULL_EDGE, 0.85);
    const thumb = await reencodeJpeg(media.uri, media.width, media.height, THUMB_EDGE, 0.7);
    return [full, { ...thumb, kind: 'thumb' }];
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
  return [
    { file: copy, kind: 'full', mime, width: media.width, height: media.height, durationMs: Math.round(media.durationMs ?? 0) },
    { ...poster, kind: 'poster' },
  ];
}

/** Encrypts and uploads prepared files. `onProgress` gets 0..1 over the total ciphertext size. */
export async function encryptAndUpload(files: Prepared[], onProgress?: (fraction: number) => void): Promise<UploadedMedia[]> {
  if (files.length === 0) return [];
  const sizes = files.map((f) => Number(Core.mediaLayout(BigInt(f.file.size)).encryptedLen));
  const slots = ok(await api.POST('/v1/media/uploads', { body: { sizes } }));
  const total = sizes.reduce((a, b) => a + b, 0);
  let done = 0;
  const out: UploadedMedia[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const slot = slots[i];
    if (!slot?.objectKey || !slot.putUrl || slot.ctSize !== sizes[i]) throw new Error('bad upload slot');
    const fileKey = Core.newSymmetricKey();
    const objectId = Core.objectIdFromObjectKey(slot.objectKey);
    const enc = new File(workDir('outbox'), `${slot.objectKey}.enc`);
    await new Promise((r) => setTimeout(r, 0)); // let the progress card render before the (synchronous) encryption
    const contentLen = Core.encryptFile(pathOf(f.file), pathOf(enc), fileKey, objectId);
    try {
      const res = await enc.upload(slot.putUrl, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: 'application/octet-stream',
        onProgress: ({ bytesSent }) => onProgress?.((done + bytesSent) / total),
      });
      if (res.status !== 200) throw new Error(`upload failed (${res.status})`);
    } finally {
      enc.delete();
    }
    done += sizes[i];
    onProgress?.(done / total);
    out.push({
      objectKey: slot.objectKey,
      kind: f.kind,
      item: { objectId, kind: KIND_CODE[f.kind], mime: f.mime, fileKey, contentLen, width: f.width, height: f.height, durationMs: BigInt(f.durationMs) },
    });
  }
  return out;
}

export function discardPrepared(files: Prepared[]) {
  for (const f of files) if (f.file.exists) f.file.delete();
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

/** Matches the media list the server returned against the signed post header (by object id and kind). */
export function matchMedia(
  header: Core.MediaItem[],
  server: { objectKey?: string; kind?: string }[],
  objectIdOf: (objectKey: string) => ArrayBuffer = Core.objectIdFromObjectKey,
): UploadedMedia[] | null {
  if (header.length !== server.length) return null;
  const out: UploadedMedia[] = [];
  for (const item of header) {
    const m = server.find((s) => s.objectKey && equalBytes(objectIdOf(s.objectKey), item.objectId));
    if (!m?.objectKey || m.kind !== kindName(item.kind)) return null;
    out.push({ objectKey: m.objectKey, kind: kindName(item.kind), item });
  }
  return out;
}

// ---------------- reading ----------------

async function getUrls(objectKeys: string[]): Promise<Map<string, string>> {
  const res = ok(await api.POST('/v1/media/download-urls', { body: { objectKeys } }));
  return new Map(res.flatMap((r) => (r.objectKey && r.getUrl ? [[r.objectKey, r.getUrl] as const] : [])));
}

const inflight = new Map<string, Promise<string>>();

/** Downloads and decrypts one image to the private cache; returns a file URI. Cached by (random) object key. */
export function decryptedUri(media: UploadedMedia): Promise<string> {
  const ext = media.item.mime === 'image/jpeg' ? 'jpg' : 'bin';
  const plain = new File(workDir('media'), `${media.objectKey}.${ext}`);
  if (plain.exists && plain.size === Number(media.item.contentLen)) return Promise.resolve(plain.uri);
  const running = inflight.get(media.objectKey);
  if (running) return running;
  const job = (async () => {
    const url = (await getUrls([media.objectKey])).get(media.objectKey);
    if (!url) throw new Error('no download url');
    const enc = new File(workDir('download'), `${media.objectKey}.enc`);
    if (enc.exists) enc.delete();
    await File.downloadFileAsync(url, enc, { idempotent: true });
    try {
      Core.decryptFile(pathOf(enc), pathOf(plain), media.item.fileKey, media.item.objectId, media.item.contentLen);
    } finally {
      enc.delete();
    }
    return plain.uri;
  })().finally(() => inflight.delete(media.objectKey));
  inflight.set(media.objectKey, job);
  return job;
}

/**
 * Starts progressive playback of an encrypted video: the core serves decrypted ranges on 127.0.0.1 while this loop
 * downloads ciphertext pieces in the order the player needs them. Call `stop()` when the player goes away.
 */
export function startPlayback(media: UploadedMedia): { url: string; stop: () => void } {
  const enc = new File(workDir('download'), `${media.objectKey}.play.enc`);
  const session = new Core.PlaybackSession(pathOf(enc), media.item.fileKey, media.item.objectId, media.item.contentLen, media.item.mime);
  let stopped = false;
  (async () => {
    let url: string | undefined;
    for (let range = session.nextRange(); range && !stopped; range = session.nextRange()) {
      url ??= (await getUrls([media.objectKey])).get(media.objectKey);
      if (!url) return;
      const res = await fetch(url, { headers: { Range: `bytes=${range.start}-${range.end - 1n}` } });
      if (res.status === 403) {
        url = undefined; // URL expired: get a fresh one and retry this piece
        continue;
      }
      if (res.status !== 206 && res.status !== 200) return;
      const body = await res.arrayBuffer();
      if (stopped) return;
      session.supply(range.start, res.status === 200 ? body.slice(Number(range.start), Number(range.end)) : body);
    }
  })().catch(() => {});
  return {
    url: session.url(),
    stop: () => {
      stopped = true;
      session.close();
      if (enc.exists) enc.delete();
    },
  };
}

/** Removes every decrypted, downloaded and picked media file, including the media libraries' own caches (sign-out). */
export function clearMediaCache() {
  for (const name of ['media', 'download', 'outbox', 'ImagePicker', 'ImageManipulator', 'VideoThumbnails', 'ExpoVideoCache']) {
    const dir = new Directory(Paths.cache, name);
    if (dir.exists) dir.delete();
  }
}
