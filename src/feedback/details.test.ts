import { describe, expect, it } from 'vitest';
import type { JobState } from '@/engine/types';
import { buildDetails, type DetailsContext } from './details';

const MB = 1024 * 1024;

function job(id: string, minutesAgo: number, extra: Partial<JobState> = {}): JobState {
  const t = Date.UTC(2026, 9, 17, 12, 0) - minutesAgo * 60_000;
  return { id, status: 'done', downloaded: 0, uploads: {}, startedAt: t, updatedAt: t, ...extra };
}

const failed = job('bad', 5, {
  status: 'done',
  name: 'secret-plans.pdf',
  sourceUrl: 'https://example.com/private/secret-plans.pdf',
  size: 3 * MB,
  uploads: {
    gofile: { sent: 1, done: true, link: 'https://gofile.io/d/abc' },
    pixeldrain: { sent: 0, done: true, error: 'Pixeldrain rejected your API key. Update it in EasyMirror settings.' },
  },
});

const ctx = (jobs: JobState[]): DetailsContext => ({
  version: '1.2.3',
  userAgent: 'TestBrowser/1.0',
  hosts: [
    { label: 'GoFile', ready: true },
    { label: 'Pixeldrain', ready: false },
  ],
  jobs,
  hostLabel: (id) => ({ gofile: 'GoFile', pixeldrain: 'Pixeldrain', catbox: 'Catbox' })[id] ?? id,
});

describe('buildDetails', () => {
  it('lists version, browser and which hosts are ready', () => {
    const text = buildDetails(ctx([]), { includeNames: false });
    expect(text).toContain('EasyMirror 1.2.3');
    expect(text).toContain('Browser: TestBrowser/1.0');
    expect(text).toContain('Hosts: GoFile (ready), Pixeldrain (not connected)');
    expect(text).toContain('No mirrors in history.');
  });

  it('leaves out file names and links unless the user opts in', () => {
    const text = buildDetails(ctx([failed]), { includeNames: false });
    expect(text).toContain('Pixeldrain: error (Pixeldrain rejected your API key.');
    expect(text).toContain('GoFile: link ready');
    expect(text).not.toContain('secret-plans');
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('gofile.io/d/abc');
  });

  it('includes them when asked', () => {
    const text = buildDetails(ctx([failed]), { includeNames: true });
    expect(text).toContain('file: secret-plans.pdf');
    expect(text).toContain('source: https://example.com/private/secret-plans.pdf');
    expect(text).toContain('GoFile: link ready https://gofile.io/d/abc');
  });

  it('puts the reported mirror first and caps the rest', () => {
    const jobs = [job('n1', 1), job('n2', 2), job('n3', 3), job('n4', 4), job('n5', 5), job('n6', 6), failed];
    const text = buildDetails(ctx(jobs), { includeNames: false, jobId: 'bad' });
    const reportedAt = text.indexOf('Reported mirror:');
    const othersAt = text.indexOf('Other recent mirrors:');
    expect(reportedAt).toBeGreaterThan(-1);
    expect(othersAt).toBeGreaterThan(reportedAt);
    expect(text.slice(reportedAt, othersAt)).toContain('3.0 MB');
    // 1 reported + 4 others = 5 mirrors in total.
    expect(text.match(/^- /gm)).toHaveLength(5);
  });
});
