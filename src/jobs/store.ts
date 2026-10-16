// Job state and settings in storage.local, shared by the background and the popup.
import type { JobState } from '@/engine/types';
import { DEFAULT_DESTINATIONS } from '@/hosts';
import type { DestinationId } from '@/hosts/types';

const JOB_PREFIX = 'job:';
export const jobKey = (id: string) => `${JOB_PREFIX}${id}`;
export const isJobKey = (key: string) => key.startsWith(JOB_PREFIX);

export async function getJob(id: string): Promise<JobState | undefined> {
  return (await browser.storage.local.get(jobKey(id)))[jobKey(id)] as JobState | undefined;
}

export async function listJobs(): Promise<JobState[]> {
  const all = await browser.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => isJobKey(k))
    .map(([, v]) => v as JobState)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export const isFinished = (job: JobState) => job.status === 'done' || job.status === 'error' || job.status === 'fallback-needed';

export async function removeJobs(ids: string[]) {
  await browser.storage.local.remove(ids.map(jobKey));
}

// Updates arrive from several places at once; serialize read-modify-write.
let writeChain: Promise<unknown> = Promise.resolve();
export function patchJob(id: string, fn: (job: JobState) => void): Promise<JobState> {
  const next = writeChain.then(async () => {
    const job = (await getJob(id)) ?? { id, status: 'queued', downloaded: 0, uploads: {}, startedAt: Date.now(), updatedAt: 0 };
    fn(job);
    job.updatedAt = Date.now();
    await browser.storage.local.set({ [jobKey(id)]: job });
    return job;
  });
  writeChain = next.catch(() => {});
  return next;
}

export interface Settings {
  destinations: DestinationId[];
}

const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const saved = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { destinations: saved?.destinations?.length ? saved.destinations : DEFAULT_DESTINATIONS };
}

export async function saveSettings(settings: Settings) {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

/** A job's outcome in a few words, for notifications and the popup. */
export function summarize(job: JobState): string {
  const ups = Object.values(job.uploads);
  const links = ups.filter((u) => u.link).length;
  if (job.status === 'error') return job.error ?? 'Failed';
  if (!ups.length) return 'No destinations';
  if (links === ups.length) return links === 1 ? 'Link ready' : `${links} links ready`;
  if (links === 0) return 'No destination accepted the file';
  return `${links} of ${ups.length} links ready`;
}
