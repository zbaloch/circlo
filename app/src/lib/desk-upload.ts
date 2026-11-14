/**
 * Adding files to the Desk. Photos and videos, from the library or picked as documents, are re-encoded and stripped of
 * their metadata first (lib/media prepare), exactly like post photos, and named by date rather than by their original
 * name. Other documents (PDFs, office files, text...) are uploaded as they are, typed so the server never serves one
 * as a web page (lib/desk deskMime). They stay private to their owner.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'react-native';

import { api, ok } from '@/api/client';
import { discardPicked, discardPrepared, fileSize, prepare, putFile, upload, type PickedMedia } from '@/lib/media';

import { deskMime, photoName, type DeskFile } from './desk';

export type Progress = (done: number, total: number) => void;

const PICK_LIMIT = 10;

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
}

/** Re-encodes a photo or video and keeps it in `folderId` (null: the top level). */
async function keepMedia(media: PickedMedia, folderId: string | null, at: Date): Promise<DeskFile> {
  const item = await prepare(media);
  try {
    // A video picked as a document has no size from the picker: its poster frame has the same shape.
    if (!item.full.width || !item.full.height) {
      item.full.width = item.preview.width;
      item.full.height = item.preview.height;
    }
    const [a] = await upload([item]);
    return ok(await api.POST('/v1/desk/files', {
      body: { folderId, name: photoName(item.type, at, item.full.mime), objectKey: a.objectKey, previewKey: a.previewKey, width: a.width, height: a.height, durationMs: a.durationMs },
    }));
  } finally {
    discardPrepared([item]);
  }
}

/** Uploads a document as it is and keeps it under its own name. */
async function keepDocument(asset: DocumentPicker.DocumentPickerAsset, folderId: string | null): Promise<DeskFile> {
  const mime = deskMime(asset.name, asset.mimeType);
  const size = asset.size ?? (await fileSize(asset.uri));
  const [slot] = ok(await api.POST('/v1/desk/uploads', { body: { files: [{ size, mime }] } }));
  await putFile(slot.putUrl, asset.uri, mime);
  return ok(await api.POST('/v1/desk/files', { body: { folderId, name: asset.name.trim().slice(0, 200) || 'File', objectKey: slot.objectKey } }));
}

/** Photos and videos from the library. Returns how many were added. */
export async function addFromLibrary(folderId: string | null, onProgress?: Progress): Promise<number> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: PICK_LIMIT, exif: false, quality: 1 });
  if (res.canceled) return 0;
  const picked: PickedMedia[] = res.assets.map((a) => ({
    uri: a.uri,
    type: a.type === 'video' ? 'video' : 'image',
    width: a.width,
    height: a.height,
    durationMs: a.duration ?? undefined,
    mimeType: a.mimeType ?? undefined,
  }));
  try {
    const at = new Date();
    for (let i = 0; i < picked.length; i++) {
      onProgress?.(i, picked.length);
      await keepMedia(picked[i], folderId, new Date(at.getTime() + i * 60_000));
    }
    onProgress?.(picked.length, picked.length);
    return picked.length;
  } finally {
    discardPicked(picked);
  }
}

/** Any files, from the phone's Files app or the computer. Returns how many were added. */
export async function addDocuments(folderId: string | null, onProgress?: Progress): Promise<number> {
  const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return 0;
  const assets = res.assets.slice(0, PICK_LIMIT);
  const at = new Date();
  for (let i = 0; i < assets.length; i++) {
    onProgress?.(i, assets.length);
    const a = assets[i];
    const mime = deskMime(a.name, a.mimeType);
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(mime)) {
      const { width, height } = await imageSize(a.uri);
      await keepMedia({ uri: a.uri, type: 'image', width, height, mimeType: mime }, folderId, at);
    } else if (/^video\/(mp4|quicktime|webm)$/.test(mime)) {
      await keepMedia({ uri: a.uri, type: 'video', width: 0, height: 0, mimeType: mime }, folderId, at);
    } else {
      await keepDocument(a, folderId);
    }
  }
  onProgress?.(assets.length, assets.length);
  discardPicked(assets.map((a) => ({ uri: a.uri, type: 'image', width: 0, height: 0 })));
  return assets.length;
}
