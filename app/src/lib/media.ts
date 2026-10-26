/**
 * The on-device media pipeline (PLAN.md Phase 7). Before anything leaves the phone:
 * - photos are re-encoded (2048 px full + 480 px thumbnail) and their EXIF/GPS/IPTC segments removed;
 * - videos keep their frames but lose location/device metadata boxes, and get a re-encoded poster frame;
 * - every file is encrypted by the core (chunked, Padmé-padded) under its own random key, bound to a random object key;
 * - the ciphertext is uploaded with a PUT URL locked to its exact size.
 * Reading reverses it: download ciphertext and decrypt in memory with the core (images; thumbnails also cached sealed
 * under the device key), or stream through the core's loopback player (video). No crypto is implemented here.
 */
import * as Core from '@halqo/core';
import { Directory, File, FileMode, Paths, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import { api, ok } from '@/api/client';

import { equalBytes, toB64 } from './bytes';
import { localCacheKey } from './keystore';
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

// Download URLs are requested in batches (≤ 50 keys per call) so a screen of thumbnails costs one request.
type UrlBatch = { keys: Set<string>; waiters: ((urls: Map<string, string> | Error) => void)[] };
let batch: UrlBatch | null = null;

function urlFor(objectKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!batch) {
      const current: UrlBatch = { keys: new Set(), waiters: [] };
      batch = current;
      setTimeout(async () => {
        batch = null;
        const keys = [...current.keys];
        const merged = new Map<string, string>();
        try {
          for (let i = 0; i < keys.length; i += 50) for (const [k, v] of await getUrls(keys.slice(i, i + 50))) merged.set(k, v);
          current.waiters.forEach((w) => w(merged));
        } catch (e) {
          current.waiters.forEach((w) => w(e instanceof Error ? e : new Error('download urls failed')));
        }
      }, 30);
    }
    batch.keys.add(objectKey);
    batch.waiters.push((r) => {
      if (r instanceof Error) return reject(r);
      const url = r.get(objectKey);
      if (url) resolve(url);
      else reject(new Error('no download url'));
    });
  });
}

/** Decrypts a whole (small) object in memory with the core's chunk decryptor: no plaintext file is ever written. */
function decryptInMemory(media: UploadedMedia, ciphertext: Uint8Array): Uint8Array {
  const layout = Core.mediaLayout(media.item.contentLen);
  if (BigInt(ciphertext.length) !== layout.encryptedLen) throw new Error('wrong ciphertext length');
  const header = ciphertext.slice(0, 20).buffer;
  const dec = new Core.MediaChunkDecryptor(media.item.fileKey, media.item.objectId, header, media.item.contentLen);
  const contentLen = Number(media.item.contentLen);
  const out = new Uint8Array(contentLen);
  let written = 0;
  for (let i = 0n; i < layout.chunks; i++) {
    const start = Number(Core.mediaChunkOffset(i));
    const end = i + 1n === layout.chunks ? ciphertext.length : Number(Core.mediaChunkOffset(i + 1n));
    const plain = new Uint8Array(dec.decryptChunk(i, ciphertext.slice(start, end).buffer));
    const take = Math.min(plain.length, contentLen - written);
    out.set(plain.subarray(0, take), written);
    written += take;
  }
  return out;
}

/** Bounded in-memory cache of decrypted images as data URIs (≈ 48 MB of base64). */
const memory = new Map<string, string>();
let memoryBytes = 0;
const MEMORY_LIMIT = 48 * 1024 * 1024;

function rememberUri(key: string, uri: string) {
  memory.set(key, uri);
  memoryBytes += uri.length;
  for (const [k, v] of memory) {
    if (memoryBytes <= MEMORY_LIMIT) break;
    memory.delete(k);
    memoryBytes -= v.length;
  }
}

const inflight = new Map<string, Promise<string>>();

/**
 * An image as a data URI, decrypted in memory. Thumbnails and posters are also cached on disk sealed with the
 * device's `local_cache_key` (CRYPTO.md section 10), so scrolling back doesn't re-download them.
 */
export function imageUri(media: UploadedMedia): Promise<string> {
  const hit = memory.get(media.objectKey);
  if (hit) {
    memory.delete(media.objectKey); // refresh LRU position
    memory.set(media.objectKey, hit);
    return Promise.resolve(hit);
  }
  const running = inflight.get(media.objectKey);
  if (running) return running;
  const job = (async () => {
    const cacheable = media.kind !== 'full';
    const sealed = new File(workDir('thumbs'), `${media.objectKey}.sealed`);
    const key = cacheable ? await localCacheKey() : null;
    let plain: Uint8Array | null = null;
    if (key && sealed.exists) {
      try {
        plain = new Uint8Array(Core.openLocal(key, media.item.objectId, (await sealed.bytes()).buffer));
      } catch {
        sealed.delete(); // corrupted or from another device key
      }
    }
    if (!plain) {
      const res = await fetch(await urlFor(media.objectKey));
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      plain = decryptInMemory(media, new Uint8Array(await res.arrayBuffer()));
      if (key) await sealed.write(new Uint8Array(Core.sealLocal(key, media.item.objectId, plain.slice().buffer)));
    }
    const uri = `data:${media.item.mime};base64,${toB64(plain)}`;
    rememberUri(media.objectKey, uri);
    return uri;
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
      url ??= await urlFor(media.objectKey).catch(() => undefined);
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
  memory.clear();
  memoryBytes = 0;
  for (const name of ['thumbs', 'media', 'download', 'outbox', 'ImagePicker', 'ImageManipulator', 'VideoThumbnails', 'ExpoVideoCache']) {
    const dir = new Directory(Paths.cache, name);
    if (dir.exists) dir.delete();
  }
}
