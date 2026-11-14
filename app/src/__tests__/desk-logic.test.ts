import { addDays, deskMime, monthGrid, monthTitle, dueLabel, fileIcon, localDate, photoName, repeatLabel, toAttachment } from '@/lib/desk';

describe('Desk dates', () => {
  it('uses the phone’s own calendar day', () => {
    expect(localDate(new Date(2026, 10, 14, 23, 59))).toBe('2026-11-14');
    expect(localDate(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-11-14', 7)).toBe('2026-11-21');
  });

  it('says when a to-do is due in words', () => {
    const today = '2026-11-14'; // a Saturday
    expect(dueLabel(null, today)).toBeNull();
    expect(dueLabel('2026-11-14', today)).toEqual({ text: 'Today', late: false });
    expect(dueLabel('2026-11-15', today)).toEqual({ text: 'Tomorrow', late: false });
    expect(dueLabel('2026-11-13', today)).toEqual({ text: 'Yesterday', late: true });
    expect(dueLabel('2026-11-02', today)).toEqual({ text: 'Nov 2', late: true });
    expect(dueLabel('2026-11-18', today)).toEqual({ text: 'Wed', late: false });
    expect(dueLabel('2026-11-28', today)).toEqual({ text: 'Nov 28', late: false });
    expect(dueLabel('2027-01-05', today)).toEqual({ text: 'Jan 5, 2027', late: false });
  });

  it('lays out a month as weeks starting on Monday', () => {
    const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[1][0]).toBe('2026-11-02');
    expect(weeks.at(-1)).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(monthTitle(2026, 10)).toBe('November 2026');
  });

  it('says how a to-do repeats', () => {
    expect(repeatLabel(null)).toBe('Doesn’t repeat');
    expect(repeatLabel({ kind: 'daily', every: 1 })).toBe('Every day');
    expect(repeatLabel({ kind: 'daily', every: 3 })).toBe('Every 3 days');
    expect(repeatLabel({ kind: 'weekdays', every: 1 })).toBe('Every weekday');
    expect(repeatLabel({ kind: 'weekly', every: 1 })).toBe('Every week');
    expect(repeatLabel({ kind: 'weekly', every: 2 })).toBe('Every 2 weeks');
    expect(repeatLabel({ kind: 'monthly', every: 1 })).toBe('Every month');
    expect(repeatLabel({ kind: 'yearly', every: 1 })).toBe('Every year');
    expect(repeatLabel({ kind: 'after', every: 7 })).toBe('7 days after it’s done');
    expect(repeatLabel({ kind: 'after', every: 1 })).toBe('1 day after it’s done');
  });
});

describe('Desk files', () => {
  it('keeps types the server accepts, and anything else as a plain download', () => {
    expect(deskMime('Boarding pass.pdf', 'application/pdf')).toBe('application/pdf');
    expect(deskMime('Notes.txt', undefined)).toBe('text/plain');
    expect(deskMime('Budget.xlsx', '')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(deskMime('page.html', 'text/html')).toBe('application/octet-stream');
    expect(deskMime('logo.svg', 'image/svg+xml')).toBe('application/octet-stream');
    expect(deskMime('archive.7z', undefined)).toBe('application/octet-stream');
    expect(deskMime('Song.M4A', undefined)).toBe('audio/mp4');
  });

  it('picks an icon by kind', () => {
    expect(fileIcon({ kind: 'image', mime: 'image/jpeg' })).toBe('image-outline');
    expect(fileIcon({ kind: 'video', mime: 'video/mp4' })).toBe('videocam');
    expect(fileIcon({ kind: 'file', mime: 'application/pdf' })).toBe('document-outline');
    expect(fileIcon({ kind: 'file', mime: 'text/plain' })).toBe('document-outline');
    expect(fileIcon({ kind: 'file', mime: 'application/zip' })).toBe('archive-outline');
    expect(fileIcon({ kind: 'file', mime: 'application/octet-stream' })).toBe('file-outline');
  });

  it('names photos and videos it re-encodes', () => {
    const at = new Date(2026, 10, 14, 9, 5);
    expect(photoName('image', at)).toBe('Photo 2026-11-14 09.05.jpg');
    expect(photoName('video', at, 'video/quicktime')).toBe('Video 2026-11-14 09.05.mov');
    expect(photoName('video', at, 'video/mp4')).toBe('Video 2026-11-14 09.05.mp4');
  });

  it('opens a photo or video file in the media viewer', () => {
    const file = {
      id: 'f1', folderId: null, name: 'Hotel.jpg', mime: 'image/jpeg', kind: 'image' as const, sizeBytes: 10, width: 800, height: 600,
      durationMs: 0, objectKey: 'a'.repeat(64), url: 'https://x/a', previewKey: 'b'.repeat(64), previewUrl: 'https://x/b', createdAt: '2026-11-14T00:00:00Z',
    };
    expect(toAttachment(file)).toEqual({
      type: 'image', mime: 'image/jpeg', width: 800, height: 600, durationMs: 0, objectKey: 'a'.repeat(64), url: 'https://x/a',
      previewKey: 'b'.repeat(64), previewUrl: 'https://x/b',
    });
    expect(toAttachment({ ...file, kind: 'file', previewKey: null, previewUrl: null })).toBeNull();
  });
});
