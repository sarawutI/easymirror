// Small API the Playwright runner calls with page.evaluate(). Lives in an extension
// page (not the service worker) so it keeps working while the worker is stopped.
import type { JobState, TransferJob, UploadSpec } from '@/engine/types';

const api = {
  startTransfer: (job: TransferJob) => browser.runtime.sendMessage({ type: 'start-transfer', job }),
  startPageFlow: (jobId: string, pageUrl: string, name: string, uploads: UploadSpec[]) =>
    browser.runtime.sendMessage({ type: 'start-pageflow', jobId, pageUrl, name, uploads }),
  async job(id: string): Promise<JobState | undefined> {
    return (await browser.storage.local.get(`job:${id}`))[`job:${id}`] as JobState | undefined;
  },
  downloads: (query: Parameters<typeof browser.downloads.search>[0]) => browser.downloads.search(query),
};

(globalThis as any).spike = api;
