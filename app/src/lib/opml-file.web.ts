/** The web app's OPML import and export: the browser's file picker, and a download. Same exports as opml-file.ts. */
import * as DocumentPicker from 'expo-document-picker';

export const OPML_NAME = 'circlo-reading.opml';

export async function pickOpmlText(): Promise<string | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['.opml', '.xml', 'text/x-opml', 'text/xml', 'application/xml'] });
  const file = picked.canceled ? undefined : picked.assets[0]?.file;
  return file ? file.text() : null;
}

export async function shareOpml(text: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/x-opml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = OPML_NAME;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
