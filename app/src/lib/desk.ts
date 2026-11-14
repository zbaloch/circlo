/**
 * Desk (owner decision 2026-11-14): a personal space for to-dos, notes and files that only its owner ever sees. Pure
 * helpers shared by the Desk screens; the server calls are in lib/desk-api.
 */
import type { components } from '@/api/schema';
import type { IconName } from '@/components/ui/icon';
import type { Attachment } from '@/lib/media';

export type DeskList = components['schemas']['DeskList'];
export type DeskTodo = components['schemas']['DeskTodo'];
export type DeskRepeat = components['schemas']['DeskRepeat'];
export type DeskNoteSummary = components['schemas']['DeskNoteSummary'];
export type DeskNote = components['schemas']['DeskNote'];
export type DeskFollowup = components['schemas']['DeskFollowup'];
export type DeskFile = components['schemas']['DeskFile'];
export type DeskFolderRef = components['schemas']['DeskFolderRef'];
export type DeskListing = components['responses']['DeskListing']['content']['application/json'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');

/** A calendar day on the phone's clock, as YYYY-MM-DD (due dates have no time or zone). */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parse(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon: never pushed over a day boundary by a clock change
}

export function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/** A day in words: Nov 2, or Jan 5, 2027 outside this year. */
export function dayText(day: string, today: string): string {
  const d = parse(day);
  const text = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return day.slice(0, 4) === today.slice(0, 4) ? text : `${text}, ${d.getFullYear()}`;
}

/** When a to-do is due, as a short label: Today, Tomorrow, Yesterday, a weekday this week, or a date; late if past. */
export function dueLabel(due: string | null | undefined, today: string): { text: string; late: boolean } | null {
  if (!due) return null;
  const days = daysBetween(today, due);
  if (days === 0) return { text: 'Today', late: false };
  if (days === 1) return { text: 'Tomorrow', late: false };
  if (days === -1) return { text: 'Yesterday', late: true };
  if (days > 1 && days < 7) return { text: WEEKDAYS[parse(due).getDay()], late: false };
  return { text: dayText(due, today), late: days < 0 };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthTitle(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

/** A month (0-based) as weeks from Monday to Sunday; days outside the month are null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1, 12);
  const days = new Date(year, month + 1, 0, 12).getDate();
  const cells: (string | null)[] = Array((first.getDay() + 6) % 7).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const plural = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);

export function repeatLabel(r: DeskRepeat | null | undefined): string {
  if (!r) return 'Doesn’t repeat';
  switch (r.kind) {
    case 'daily':
      return r.every === 1 ? 'Every day' : `Every ${plural(r.every, 'day')}`;
    case 'weekdays':
      return 'Every weekday';
    case 'weekly':
      return r.every === 1 ? 'Every week' : `Every ${plural(r.every, 'week')}`;
    case 'monthly':
      return r.every === 1 ? 'Every month' : `Every ${plural(r.every, 'month')}`;
    case 'yearly':
      return r.every === 1 ? 'Every year' : `Every ${plural(r.every, 'year')}`;
    case 'after':
      return `${plural(r.every, 'day')} after it’s done`;
  }
}

/** The repeat choices offered on a to-do, in order. */
export const REPEAT_KINDS: DeskRepeat['kind'][] = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'after'];

// ---------------- files ----------------

/** Types the server keeps as they are (DeskFilesController.MIME). Anything else is kept as a plain download. */
const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', rtf: 'application/rtf', zip: 'application/zip',
  epub: 'application/epub+zip', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};
const ACCEPTED = new Set([...Object.values(BY_EXTENSION), 'audio/x-m4a', 'application/octet-stream']);

/** The type to store a picked file as: its own if the server accepts it, else a plain download (never a web page). */
export function deskMime(name: string, mime: string | null | undefined): string {
  if (mime && ACCEPTED.has(mime)) return mime;
  if (mime && mime !== 'application/octet-stream') return 'application/octet-stream';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return BY_EXTENSION[ext] ?? 'application/octet-stream';
}

export function fileIcon(file: Pick<DeskFile, 'kind' | 'mime'>): IconName {
  if (file.kind === 'image') return 'image-outline';
  if (file.kind === 'video') return 'videocam';
  if (file.mime === 'application/zip' || file.mime === 'application/epub+zip') return 'archive-outline';
  if (file.mime === 'application/octet-stream') return 'file-outline';
  return 'document-outline';
}

/** A name for a photo or video re-encoded before upload (its original name may carry the camera's details). */
export function photoName(type: 'image' | 'video', at: Date, mime?: string): string {
  const stamp = `${localDate(at)} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
  if (type === 'image') return `Photo ${stamp}.jpg`;
  return `Video ${stamp}.${mime === 'video/quicktime' ? 'mov' : mime === 'video/webm' ? 'webm' : 'mp4'}`;
}

/** A photo or video file as the media viewer and video player take it; null for other files. */
export function toAttachment(file: DeskFile): Attachment | null {
  if ((file.kind !== 'image' && file.kind !== 'video') || !file.previewKey || !file.previewUrl) return null;
  return {
    type: file.kind,
    mime: file.mime,
    width: file.width,
    height: file.height,
    durationMs: file.durationMs,
    objectKey: file.objectKey,
    url: file.url,
    previewKey: file.previewKey,
    previewUrl: file.previewUrl,
  };
}
