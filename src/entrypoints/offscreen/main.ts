// Transfer engine. Runs in an offscreen document so a long transfer survives the
// service worker being stopped. Offscreen documents only get browser.runtime, so all
// state goes back to the background as messages.
import { fileNameFrom, formatBytes } from '@/engine/filename';
import { openSource, openTemp, removeTemp, saveToTemp, upload } from '@/engine/transfer';
import type { DestinationCheck, EngineEvent, FileInfo, JobState, TransferJob, UploadPlan, UploadSpec, UploadState } from '@/engine/types';

const PROGRESS_INTERVAL_MS = 500;

function send(event: EngineEvent) {
  return browser.runtime.sendMessage(event).catch(() => {});
}

let peakHeap = 0;
function sampleHeap() {
  const used = (performance as any).memory?.usedJSHeapSize ?? 0;
  peakHeap = Math.max(peakHeap, used);
  return peakHeap;
}

function throttled<T extends unknown[]>(fn: (...args: T) => void) {
  let last = 0;
  return (...args: T) => {
    const now = Date.now();
    if (now - last >= PROGRESS_INTERVAL_MS) {
      last = now;
      fn(...args);
    }
  };
}

const message = (e: unknown) => String((e as Error)?.message ?? e);

function looksLikeWebPage(res: Response) {
  const type = res.headers.get('content-type') ?? '';
  const disposition = res.headers.get('content-disposition') ?? '';
  return /text\/html|application\/xhtml/i.test(type) && !/attachment/i.test(disposition);
}

/** Before downloading: does any destination take this file? (The spike runner fixes its uploads up front.) */
async function anyDestination(job: TransferJob, info: FileInfo): Promise<boolean> {
  if (job.uploads) return job.uploads.length > 0;
  const check = (await browser.runtime.sendMessage({
    target: 'background',
    type: 'check-destinations',
    id: job.id,
    info,
  } satisfies EngineEvent)) as DestinationCheck | undefined;
  return (check?.accepted ?? 0) > 0;
}

/** Once the file is on disk: the uploads, with each host's upload opened just now. */
async function prepareUploads(job: TransferJob, file: File): Promise<UploadSpec[]> {
  if (job.uploads) return job.uploads;
  const plan = (await browser.runtime.sendMessage({
    target: 'background',
    type: 'prepare-uploads',
    id: job.id,
    info: { name: file.name, size: file.size, type: file.type || undefined },
  } satisfies EngineEvent)) as UploadPlan | undefined;
  return plan?.uploads ?? [];
}

async function run(job: TransferJob) {
  const update = (patch: Partial<JobState>) =>
    send({ target: 'background', type: 'job-update', id: job.id, patch: { ...patch, peakHeapBytes: sampleHeap() } });
  const tempName = `${job.id}.part`;

  try {
    const file = job.picked ? await usePickedFile(job, job.picked, tempName, update) : await download(job, tempName, update);
    if (!file) return;
    job.uploads = await prepareUploads(job, file);
    if (!job.uploads.length) {
      // Every host was skipped or couldn't open an upload; the reasons are on the job.
      update({ status: 'done' });
      return;
    }
    await uploadAll(job, file, update);
  } catch (e) {
    update({ status: 'error', error: message(e) });
  } finally {
    await removeTemp(tempName);
  }
}

/** Downloads the source into temp storage. Returns undefined when there's nothing to upload. */
async function download(job: TransferJob, tempName: string, update: (p: Partial<JobState>) => unknown): Promise<File | undefined> {
  const source = job.source!;
  let res: Response;
  try {
    res = await openSource(source);
    // On a refetch, a web page instead of the file usually means a login or
    // error page; treat it as a failed refetch so the browser's copy is kept.
    if (job.confirmSource && looksLikeWebPage(res)) {
      await res.body?.cancel();
      throw new Error('the host answered with a web page instead of the file');
    }
  } catch (e) {
    if (job.confirmSource) send({ target: 'background', type: 'source-failed', id: job.id, error: message(e) });
    else update({ status: 'error', error: `Couldn't download the file: ${message(e)}` });
    return undefined;
  }
  if (job.confirmSource) send({ target: 'background', type: 'source-ok', id: job.id });

  if (!job.confirmSource && looksLikeWebPage(res)) {
    await res.body?.cancel();
    send({ target: 'background', type: 'source-is-page', id: job.id, url: res.url || source.url });
    return undefined;
  }

  const info: FileInfo = {
    name: job.name ?? fileNameFrom(res.url || source.url, res.headers.get('content-disposition')),
    size: Number(res.headers.get('content-length')) || undefined,
    type: res.headers.get('content-type') ?? undefined,
  };
  update({ name: info.name, size: info.size, total: info.size });

  if (!(await anyDestination(job, info))) {
    // Every destination turned the file down; the reasons are already on the job.
    await res.body?.cancel();
    update({ status: 'done' });
    return undefined;
  }

  update({ status: 'downloading' });
  const progress = throttled((loaded: number, total?: number) => update({ downloaded: loaded, total }));
  let saved: File;
  try {
    saved = await saveToTemp(res, tempName, progress);
  } catch (e) {
    throw new Error(`Couldn't download the file: ${message(e)}`);
  }
  return new File([saved], info.name, { type: saved.type || info.type || 'application/octet-stream' });
}

async function usePickedFile(
  job: TransferJob,
  info: FileInfo,
  tempName: string,
  update: (p: Partial<JobState>) => unknown,
): Promise<File | undefined> {
  update({ name: info.name, size: info.size, total: info.size, downloaded: info.size ?? 0, error: undefined });
  if (!(await anyDestination(job, info))) {
    update({ status: 'done' });
    return undefined;
  }
  const stored = await openTemp(tempName);
  return new File([stored], info.name, { type: info.type || 'application/octet-stream' });
}

async function uploadAll(job: TransferJob, file: File, update: (p: Partial<JobState>) => unknown) {
  const uploadUpdate = (label: string, patch: UploadState) =>
    send({ target: 'background', type: 'upload-update', id: job.id, label, patch });
  update({ status: 'uploading', downloaded: file.size, total: file.size, size: file.size });

  // One file feeds every destination; uploads run in parallel from disk.
  await Promise.all(
    job.uploads!.map(async (spec) => {
      if (spec.maxBytes !== undefined && file.size > spec.maxBytes) {
        await uploadUpdate(spec.label, {
          sent: 0,
          done: true,
          skipped: `Too big for this host (${formatBytes(file.size)}, limit ${formatBytes(spec.maxBytes)})`,
        });
        return;
      }
      const report = throttled((sent: number) => uploadUpdate(spec.label, { sent, done: false }));
      try {
        const r = await upload(file, spec, report);
        await uploadUpdate(spec.label, { sent: file.size, done: true, status: r.status, response: r.response.slice(0, 4000) });
      } catch (e) {
        await uploadUpdate(spec.label, { sent: 0, done: true, error: message(e) });
      }
    }),
  );
  update({ status: 'done' });
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'transfer') run(msg.job as TransferJob);
});
