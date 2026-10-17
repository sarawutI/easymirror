// The technical details a user can attach to a bug report. Shown to them in full
// before anything is sent; file names and links only when they opt in.
import { formatBytes } from '@/engine/filename';
import type { JobState, UploadState } from '@/engine/types';

export interface DetailsContext {
  version: string;
  userAgent: string;
  /** Host label and whether it's usable (account connected, or none needed). */
  hosts: { label: string; ready: boolean }[];
  /** Newest first. */
  jobs: JobState[];
  /** Turns a destination id into its label. */
  hostLabel(id: string): string;
}

export interface DetailsOptions {
  /** Include file names, source links and share links. Off by default. */
  includeNames: boolean;
  /** The mirror the user is reporting, listed first. */
  jobId?: string;
}

const RECENT_JOBS = 5;

function uploadSummary(up: UploadState): string {
  if (up.link) return 'link ready';
  if (up.skipped) return `skipped (${up.skipped})`;
  if (up.error) return `error (${up.error})`;
  return up.done ? 'not uploaded' : `in progress (${formatBytes(up.sent)} sent)`;
}

function jobLines(job: JobState, ctx: DetailsContext, opts: DetailsOptions): string[] {
  const when = new Date(job.startedAt).toISOString().replace('T', ' ').slice(0, 16);
  const head = [when, job.status, job.size !== undefined ? formatBytes(job.size) : undefined, job.pageMode ? `page flow (${job.pageMode})` : undefined]
    .filter(Boolean)
    .join(' · ');
  const lines = [`- ${head}`];
  if (job.error) lines.push(`  error: ${job.error}`);
  if (opts.includeNames) {
    if (job.name) lines.push(`  file: ${job.name}`);
    if (job.sourceUrl) lines.push(`  source: ${job.sourceUrl}`);
  }
  for (const [id, up] of Object.entries(job.uploads)) {
    lines.push(`  ${ctx.hostLabel(id)}: ${uploadSummary(up)}${opts.includeNames && up.link ? ` ${up.link}` : ''}`);
  }
  return lines;
}

export function buildDetails(ctx: DetailsContext, opts: DetailsOptions): string {
  const reported = opts.jobId ? ctx.jobs.find((j) => j.id === opts.jobId) : undefined;
  const others = ctx.jobs.filter((j) => j !== reported).slice(0, reported ? RECENT_JOBS - 1 : RECENT_JOBS);
  const lines = [
    `EasyMirror ${ctx.version}`,
    `Browser: ${ctx.userAgent}`,
    `Hosts: ${ctx.hosts.map((h) => `${h.label} (${h.ready ? 'ready' : 'not connected'})`).join(', ')}`,
  ];
  if (reported) lines.push('', 'Reported mirror:', ...jobLines(reported, ctx, opts));
  if (others.length) lines.push('', reported ? 'Other recent mirrors:' : 'Recent mirrors:', ...others.flatMap((j) => jobLines(j, ctx, opts)));
  if (!reported && !others.length) lines.push('', 'No mirrors in history.');
  return lines.join('\n');
}
