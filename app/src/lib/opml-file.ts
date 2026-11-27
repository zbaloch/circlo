/**
 * Moving sources between readers on phones: pick another reader's OPML file (the system file picker, no permission
 * needed), or hand ours to the share sheet (Save to Files, AirDrop, email). The web app has its own (opml-file.web.ts).
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export const OPML_NAME = 'circlo-feeds.opml';

/** The picked file's text, or null if nothing was picked. */
export async function pickOpmlText(): Promise<string | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets[0]) return null;
  const file = new File(picked.assets[0].uri);
  try {
    return await file.text();
  } finally {
    if (file.exists) file.delete();
  }
}

/** Offers the file to the share sheet. */
export async function shareOpml(text: string): Promise<void> {
  const file = new File(Paths.cache, OPML_NAME);
  if (file.exists) file.delete();
  await file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/x-opml', UTI: 'public.xml', dialogTitle: 'Export your sources' });
}
