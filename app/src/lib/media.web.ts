/**
 * Photos and videos in the web app. Photos are re-drawn on a canvas and saved as JPEG, which keeps none of the
 * original's EXIF/GPS data; a video is uploaded as picked, with a poster frame taken from it in the browser. Files go
 * straight to storage with presigned PUTs locked to their size and type.
 */
import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

export const MAX_IMAGES = 4;
export const MAX_VIDEOS = 1;
const FULL_EDGE = 2048;
const THUMB_EDGE = 480;
const POSTER_EDGE = 1280;

export type Attachment = components['schemas']['Attachment'];
export type NewAttachment = components['schemas']['NewAttachment'];
export type PickedMedia = { uri: string; type: 'image' | 'video'; width: number; height: number; durationMs?: number; mimeType?: string };

type Prepared = { blob: Blob; mime: string; width: number; height: number };
export type PreparedItem = { type: 'image' | 'video'; full: Prepared; preview: Prepared; durationMs: number };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Couldn’t read that photo.'));
    img.src = src;
  });
}

/** Draws a frame or image onto a canvas at most `edge` px on the long side and encodes it as JPEG. */
function toJpeg(source: CanvasImageSource, width: number, height: number, edge: number, quality: number): Promise<Prepared> {
  const scale = Math.min(1, edge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve({ blob, mime: 'image/jpeg', width: w, height: h }) : reject(new Error('encode failed'))), 'image/jpeg', quality),
  );
}

function posterFrame(src: string): Promise<{ frame: Prepared; width: number; height: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, video.duration || 0);
    };
    video.onseeked = () => {
      toJpeg(video, video.videoWidth, video.videoHeight, POSTER_EDGE, 0.8).then(
        (frame) => resolve({ frame, width: video.videoWidth, height: video.videoHeight, durationMs: Math.round((video.duration || 0) * 1000) }),
        reject,
      );
    };
    video.onerror = () => reject(new Error('Couldn’t read that video.'));
    video.src = src;
  });
}

export async function prepare(media: PickedMedia): Promise<PreparedItem> {
  if (media.type === 'image') {
    const img = await loadImage(media.uri);
    const full = await toJpeg(img, img.naturalWidth, img.naturalHeight, FULL_EDGE, 0.85);
    const preview = await toJpeg(img, img.naturalWidth, img.naturalHeight, THUMB_EDGE, 0.7);
    return { type: 'image', full, preview, durationMs: 0 };
  }
  const blob = await (await fetch(media.uri)).blob();
  const mime = blob.type || media.mimeType || 'video/mp4';
  if (!/^video\/(mp4|quicktime|webm)$/.test(mime)) throw new Error('Only MP4, MOV and WebM videos are supported.');
  const { frame, width, height, durationMs } = await posterFrame(media.uri);
  return { type: 'video', full: { blob, mime, width, height }, preview: frame, durationMs };
}

function put(url: string, file: Prepared, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.mime);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error(`upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(file.blob);
  });
}

export async function upload(items: PreparedItem[], onProgress?: (fraction: number) => void): Promise<NewAttachment[]> {
  if (items.length === 0) return [];
  const files = items.flatMap((i) => [i.full, i.preview]);
  const slots = ok(await api.POST('/v1/media/uploads', { body: { files: files.map((f) => ({ size: f.blob.size, mime: f.mime as never })) } }));
  const total = files.reduce((a, f) => a + f.blob.size, 0);
  let done = 0;
  for (let i = 0; i < files.length; i++) {
    await put(slots[i].putUrl, files[i], (sent) => onProgress?.((done + sent) / total));
    done += files[i].blob.size;
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

export async function uploadAvatar(media: PickedMedia): Promise<string> {
  const img = await loadImage(media.uri);
  const photo = await toJpeg(img, img.naturalWidth, img.naturalHeight, 1024, 0.85);
  const [slot] = ok(await api.POST('/v1/media/uploads', { body: { files: [{ size: photo.blob.size, mime: 'image/jpeg' }] } }));
  await put(slot.putUrl, photo, () => undefined);
  return slot.objectKey;
}

export function discardPrepared(_items: PreparedItem[]) {
  // Blobs are garbage-collected.
}

export function discardPicked(media: PickedMedia[]) {
  for (const m of media) if (m.uri.startsWith('blob:')) URL.revokeObjectURL(m.uri);
}

export function clearMediaCache() {
  // Nothing is written to disk in the browser.
}
