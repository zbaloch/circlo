import { REPORT_REASONS, reportBody } from '@/lib/report';

jest.mock('@/api/client', () => ({}));

describe('reports', () => {
  it('sends the kind, target, reason and a trimmed note', () => {
    expect(reportBody('post', 'p1', 'spam', '  look at this  ')).toEqual({ kind: 'post', targetId: 'p1', reason: 'spam', note: 'look at this' });
    expect(reportBody('user', 'u1', 'harassment', '   ')).toEqual({ kind: 'user', targetId: 'u1', reason: 'harassment' });
    expect(reportBody('message', 'm1', 'other', 'x'.repeat(1500)).note).toHaveLength(1000);
  });

  it('only accepts known reasons', () => {
    expect(REPORT_REASONS.map((r) => r.id)).toContain('child_safety');
    expect(() => reportBody('post', 'p1', 'nope' as never, '')).toThrow();
  });
});
