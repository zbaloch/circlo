/** Twitter-style relative time: "now", "45s", "12m", "3h", "5d", then a short date. */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const d = new Date(ms);
  const month = d.toLocaleString('en', { month: 'short' });
  return d.getFullYear() === new Date(now).getFullYear() ? `${month} ${d.getDate()}` : `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
