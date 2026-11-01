/**
 * Reports to Circlo's moderators (PLAN.md Phase 11; Apple guideline 1.2, Google Play's UGC policy). The server keeps a
 * copy of what was reported, so deleting it afterwards doesn't erase it. The person reported isn't told.
 */
import { api, ok } from '@/api/client';

export const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'hate', label: 'Hate or threats of violence' },
  { id: 'sexual', label: 'Nudity or sexual content' },
  { id: 'child_safety', label: 'Puts a child at risk' },
  { id: 'self_harm', label: 'Self-harm or suicide' },
  { id: 'spam', label: 'Spam, scam or fake account' },
  { id: 'other', label: 'Something else' },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

export type ReportKind = 'post' | 'user' | 'message' | 'reply';

const MAX_NOTE = 1000;

/** The request body (pure; exported for tests). */
export function reportBody(kind: ReportKind, targetId: string, reason: ReportReason, note: string) {
  if (!REPORT_REASONS.some((r) => r.id === reason)) throw new Error('unknown report reason');
  const clean = note.trim().slice(0, MAX_NOTE);
  return { kind, targetId, reason, ...(clean ? { note: clean } : {}) };
}

export async function report(kind: ReportKind, targetId: string, reason: ReportReason, note: string): Promise<void> {
  ok(await api.POST('/v1/reports', { body: reportBody(kind, targetId, reason, note) }));
}
