// Job lifecycle: starting mirrors, answering the engine, finishing, cancelling,
// retrying, and closing out jobs an interruption cut off.
import { clearTemp } from '@/engine/transfer';
import type { DestinationCheck, EngineEvent, FileInfo, JobState, TransferJob, UploadPlan, UploadSpec, UploadState } from '@/engine/types';
import { destinationById } from '@/hosts';
import { getJob, isFinished, listJobs, patchJob, pruneJobs, summarize } from '@/jobs/store';
import type { EngineRequest } from '@/messages';
import { endFlow, openPageFlow, releaseDownload } from './flows';

const OFFSCREEN_URL = 'offscreen.html';
/** Finished mirrors kept in the popup's list; older ones are deleted. */
export const KEEP_FINISHED = 30;

// --- The engine ---------------------------------------------------------------------

async function ensureOffscreen() {
  const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await browser.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS'],
      justification: 'Downloads files to temporary storage and uploads them to the chosen hosts.',
    })
    .catch((e) => {
      // Two jobs starting together can race; a second create fails harmlessly.
      if (!String(e).includes('Only a single offscreen')) throw e;
    });
}

const toEngine = (request: EngineRequest) => browser.runtime.sendMessage(request);

export async function startTransfer(job: TransferJob) {
  if (import.meta.env.FIREFOX) {
    // Firefox has no offscreen documents, but its background page stays loaded, so the
    // engine runs right here and its events are handled directly.
    const { runJob } = await import('@/engine/engine');
    void runJob(job, handleEngineEvent);
    return;
  }
  await ensureOffscreen();
  await toEngine({ target: 'offscreen', type: 'transfer', job });
}

async function stopTransfer(id: string) {
  if (import.meta.env.FIREFOX) {
    const { cancelRun } = await import('@/engine/engine');
    cancelRun(id);
    return;
  }
  // No offscreen document means nothing is running; that's fine.
  await toEngine({ target: 'offscreen', type: 'cancel', id }).catch(() => {});
}

// --- Starting -----------------------------------------------------------------------

export async function newJob(destinationIds: string[], init: (j: JobState) => void): Promise<string> {
  const id = crypto.randomUUID();
  await patchJob(id, (j) => {
    j.status = 'queued';
    for (const d of destinationIds) if (destinationById(d)) j.uploads[d] = { sent: 0, done: false };
    init(j);
  });
  await updateBadge();
  return id;
}

/** Mirrors a link. If it turns out to be a download page, the engine hands it to the page flow. */
export async function startMirror(url: string, destinationIds: string[]): Promise<string> {
  const id = await newJob(destinationIds, (j) => (j.sourceUrl = url));
  await startTransfer({ id, source: { url } });
  return id;
}

/** Uploads a file the user picked (the page already copied it to temp storage). */
export async function startPicked(id: string, info: FileInfo) {
  await patchJob(id, (j) => {
    j.status = 'queued';
    j.error = undefined;
    j.notified = false;
    for (const k of Object.keys(j.uploads)) j.uploads[k] = { sent: 0, done: false };
  });
  await updateBadge();
  await startTransfer({ id, picked: info });
}

/** Runs a finished mirror again from its link, for the hosts that didn't get the file. */
export async function retryJob(id: string) {
  const job = await getJob(id);
  if (!job || !isFinished(job) || !job.sourceUrl) return;
  await patchJob(id, (j) => {
    j.status = 'queued';
    for (const key of ['error', 'cancelled', 'interrupted', 'notified', 'pageMode', 'rate'] as const) delete j[key];
    j.downloaded = 0;
    // Links already made stay; hosts that skipped the file (size, type) would skip it again.
    for (const [destId, u] of Object.entries(j.uploads)) if (!u.link && !u.skipped) j.uploads[destId] = { sent: 0, done: false };
    j.startedAt = Date.now(); // back to the top of the list
  });
  await updateBadge();
  await startTransfer({ id, source: { url: job.sourceUrl } });
}

/** Destinations of a job that are still waiting for the file. */
const pendingDestinations = (job: JobState | undefined) =>
  Object.entries(job?.uploads ?? {})
    .filter(([, u]) => !u.done)
    .map(([destId]) => destId);

/** Called by the engine once the source answers, before downloading: which destinations would take the file? */
async function checkDestinations(id: string, info: FileInfo): Promise<DestinationCheck> {
  const skipped: Record<string, UploadState> = {};
  let accepted = 0;
  for (const destId of pendingDestinations(await getJob(id))) {
    const reason = destinationById(destId)?.check(info);
    if (reason) skipped[destId] = { sent: 0, done: true, skipped: reason };
    else accepted++;
  }
  await patchJob(id, (j) => Object.assign(j.uploads, skipped));
  return { accepted };
}

/**
 * Called by the engine once the file is on disk, with its exact size: opens each
 * remaining host's upload. Not earlier, so upload sessions can't expire during a long download.
 */
async function prepareUploads(id: string, info: FileInfo): Promise<UploadPlan> {
  const uploads: UploadSpec[] = [];
  const outcome: Record<string, UploadState> = {};
  // Hosts are prepared in parallel; one failing (e.g. signed out) doesn't stop the rest.
  await Promise.all(
    pendingDestinations(await getJob(id)).map(async (destId) => {
      const dest = destinationById(destId);
      if (!dest) return;
      // Checked again now that the size is certain (the source may not have said).
      const reason = dest.check(info);
      if (reason) {
        outcome[destId] = { sent: 0, done: true, skipped: reason };
        return;
      }
      try {
        const spec = await dest.buildUpload(info);
        uploads.push(spec);
        outcome[destId] = { sent: 0, done: false, meta: spec.meta };
      } catch (e) {
        outcome[destId] = { sent: 0, done: true, error: String((e as Error).message ?? e) };
      }
    }),
  );
  await patchJob(id, (j) => Object.assign(j.uploads, outcome));
  return { uploads };
}

/** Hosts' answers become clickable links in the popup, so only web links are accepted. */
function checkedLink(link: string, host: string): string {
  const trimmed = link.trim();
  try {
    const { protocol } = new URL(trimmed);
    if (protocol === 'https:' || protocol === 'http:') return trimmed;
  } catch {
    // not a URL at all
  }
  throw new Error(`${host} answered with something that isn't a web link`);
}

// --- Engine events --------------------------------------------------------------------

export async function handleEngineEvent(ev: EngineEvent): Promise<unknown> {
  // A cancelled job ignores whatever the engine still sends while it stops.
  if ((await getJob(ev.id))?.cancelled) {
    if (ev.type === 'check-destinations') return { accepted: 0 } satisfies DestinationCheck;
    if (ev.type === 'prepare-uploads') return { uploads: [] } satisfies UploadPlan;
    return undefined;
  }
  if (ev.type === 'check-destinations') return checkDestinations(ev.id, ev.info);
  if (ev.type === 'prepare-uploads') return prepareUploads(ev.id, ev.info);
  if (ev.type === 'source-is-page') return openPageFlow(ev.id, ev.url);
  if (ev.type === 'job-update') {
    const job = await patchJob(ev.id, (j) => {
      const peak = Math.max(j.peakHeapBytes ?? 0, ev.patch.peakHeapBytes ?? 0);
      Object.assign(j, ev.patch, { peakHeapBytes: peak });
    });
    await maybeFinish(job);
  } else if (ev.type === 'upload-update') {
    const patch = { ...ev.patch };
    const dest = destinationById(ev.label);
    const meta = (await getJob(ev.id))?.uploads[ev.label]?.meta;
    if (patch.done && !patch.error && !patch.skipped && dest) {
      try {
        patch.link = checkedLink(await dest.parseResponse(patch.status ?? 0, patch.response ?? '', meta), dest.label);
      } catch (e) {
        patch.error = String((e as Error).message ?? e);
      }
    }
    const job = await patchJob(ev.id, (j) => {
      j.uploads[ev.label] = { ...patch, meta };
    });
    await maybeFinish(job);
  } else if (ev.type === 'source-ok' || ev.type === 'source-failed') {
    const flow = await endFlow(ev.id);
    if (flow?.downloadId === undefined) return;
    if (ev.type === 'source-ok') {
      await releaseDownload(flow, 'drop');
    } else {
      await releaseDownload(flow, 'resume');
      await needFile(
        ev.id,
        `EasyMirror couldn't fetch the file again (${ev.error}), so your browser is downloading it instead. When it finishes, choose the file.`,
      );
    }
  }
}

// --- Finishing ------------------------------------------------------------------------

export async function updateBadge() {
  const active = (await listJobs()).filter((j) => !isFinished(j)).length;
  // Firefox's build is Manifest V2, where the toolbar button is browserAction.
  const button = browser.action ?? (browser as any).browserAction;
  await button.setBadgeBackgroundColor({ color: '#2563eb' });
  await button.setBadgeText({ text: active ? String(active) : '' });
}

export async function needFile(jobId: string, error: string) {
  const job = await patchJob(jobId, (j) => {
    j.status = 'fallback-needed';
    j.error = error;
  });
  await maybeFinish(job);
}

/** Notifies once, when the transfer and every upload have settled. */
export async function maybeFinish(job: JobState) {
  const uploadsSettled = Object.values(job.uploads).every((u) => u.done);
  if (!isFinished(job) || (job.status === 'done' && !uploadsSettled)) return;
  let first = false;
  await patchJob(job.id, (j) => {
    first = !j.notified;
    j.notified = true;
  });
  if (!first) return;
  await pruneJobs(KEEP_FINISHED);
  await updateBadge();
  await browser.notifications.clear(`${job.id}:hint`).catch(() => {});
  const needsFile = job.status === 'fallback-needed';
  const failed = job.status === 'error' || !Object.values(job.uploads).some((u) => u.link);
  await browser.notifications
    .create(job.id, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: needsFile ? 'Choose the downloaded file' : failed ? 'Mirror failed' : 'Mirror finished',
      message: needsFile ? 'Open EasyMirror and choose the file you just downloaded to finish mirroring.' : `${job.name ?? job.sourceUrl ?? 'File'}: ${summarize(job)}`,
    })
    .catch(() => {});
}

/** Stops a mirror: one waiting for the user's click, or one downloading or uploading. */
export async function cancelJob(id: string) {
  const flow = await endFlow(id);
  if (flow) await releaseDownload(flow, 'drop');
  const job = await getJob(id);
  if (!job || isFinished(job)) return;
  const running = job.status !== 'waiting-for-user';
  await patchJob(id, (j) => {
    j.status = 'error';
    j.error = 'Cancelled';
    j.cancelled = true;
    j.notified = true;
    delete j.rate;
    for (const u of Object.values(j.uploads)) if (!u.done) Object.assign(u, { done: true, error: 'Cancelled', rate: undefined });
  });
  if (running) await stopTransfer(id);
  await browser.notifications.clear(`${id}:hint`).catch(() => {});
  await updateBadge();
}

/**
 * At browser start, or after EasyMirror was updated or reloaded, no transfer is running:
 * close out jobs that were cut off, and delete the temp files they left behind.
 */
export async function recoverInterrupted() {
  for (const cut of (await listJobs()).filter((j) => !isFinished(j))) {
    await patchJob(cut.id, (j) => {
      j.status = 'error';
      j.error = 'Interrupted: the browser closed or EasyMirror was updated before this finished.';
      j.interrupted = true;
      j.notified = true;
      delete j.rate;
    });
  }
  await clearTemp();
  await updateBadge();
}
