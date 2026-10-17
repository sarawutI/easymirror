// Page flow: the file sits behind a host's download page, so EasyMirror watches a tab
// until the user clicks "download" there, then takes over that download.
import type { Browser } from 'wxt/browser';
import type { FetchSpec, UploadSpec } from '@/engine/types';
import { patchJob } from '@/jobs/store';
import { maybeFinish, needFile, startTransfer } from './jobs';

export interface PageFlow {
  jobId: string;
  tabId: number;
  /** true when EasyMirror opened the tab (and may close it afterwards). */
  openedByUs: boolean;
  /** Origins the tab has shown, to recognize downloads it starts (via referrer). */
  pageOrigins: string[];
  /** Requests seen in that tab, so a form POST can be replayed with its body. */
  requests: Record<string, Pick<FetchSpec, 'method' | 'form'>>;
  downloadId?: number;
  /** Spike runner only: fixed name and uploads. */
  name?: string;
  uploads?: UploadSpec[];
}

// The service worker can be stopped at any time, so flows live in session storage.
const flowsKey = 'pageflows';

async function getFlows(): Promise<Record<string, PageFlow>> {
  return ((await browser.storage.session.get(flowsKey))[flowsKey] as Record<string, PageFlow>) ?? {};
}

// Tabs with a page flow, kept in memory so webRequest can ignore every other tab cheaply.
let watchedTabs = new Set<number>();
const watchedReady = getFlows().then((flows) => {
  watchedTabs = new Set(Object.values(flows).map((f) => f.tabId));
});

// webRequest and downloads events land together; serialize flow edits.
let flowChain: Promise<unknown> = Promise.resolve();
function updateFlows<T>(fn: (flows: Record<string, PageFlow>) => T): Promise<T> {
  const next = flowChain.then(async () => {
    const flows = await getFlows();
    const result = fn(flows);
    await browser.storage.session.set({ [flowsKey]: flows });
    watchedTabs = new Set(Object.values(flows).map((f) => f.tabId));
    return result;
  });
  flowChain = next.catch(() => {});
  return next;
}

const originOf = (url?: string) => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

async function hint(jobId: string, message: string) {
  await browser.notifications
    .create(`${jobId}:hint`, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: 'EasyMirror is waiting',
      message,
    })
    .catch(() => {});
}

/** Opens a host's download page in a new tab and waits for the user's download there. */
export async function openPageFlow(jobId: string, pageUrl: string, extra: Pick<PageFlow, 'name' | 'uploads'> = {}) {
  // Open blank first so the flow is registered before the page's own requests start.
  const tab = await browser.tabs.create({ url: 'about:blank', active: true });
  await updateFlows((flows) => {
    flows[jobId] = { jobId, tabId: tab.id!, openedByUs: true, pageOrigins: [originOf(pageUrl)!], requests: {}, ...extra };
  });
  await browser.tabs.update(tab.id!, { url: pageUrl });
  await patchJob(jobId, (j) => {
    j.status = 'waiting-for-user';
    j.pageMode = 'opened';
    for (const u of extra.uploads ?? []) j.uploads[u.label] = { sent: 0, done: false };
  });
  await hint(jobId, 'Click the download button on the page that just opened. EasyMirror will mirror that file.');
}

/** Waits for the next download the user starts in an existing tab. */
export async function watchTab(jobId: string, tabId: number, pageUrl?: string) {
  await updateFlows((flows) => {
    flows[jobId] = { jobId, tabId, openedByUs: false, pageOrigins: [originOf(pageUrl)].filter((o): o is string => !!o), requests: {} };
  });
  await patchJob(jobId, (j) => {
    j.status = 'waiting-for-user';
    j.pageMode = 'watching';
  });
  await hint(jobId, 'Click the download button on this page. EasyMirror will mirror that file.');
}

export async function endFlow(jobId: string): Promise<PageFlow | undefined> {
  return updateFlows((flows) => {
    const f = flows[jobId];
    delete flows[jobId];
    return f;
  });
}

/**
 * What happens to the browser's own (paused) copy of the download: 'drop' once EasyMirror
 * has the file or the user cancelled, 'resume' when EasyMirror couldn't fetch it again.
 */
export async function releaseDownload(flow: PageFlow, how: 'drop' | 'resume') {
  if (flow.downloadId === undefined) return;
  if (how === 'resume') {
    await browser.downloads.resume(flow.downloadId).catch(() => {});
    return;
  }
  await browser.downloads.cancel(flow.downloadId).catch(() => {});
  await browser.downloads.erase({ id: flow.downloadId }).catch(() => {});
  if (flow.openedByUs) await browser.tabs.remove(flow.tabId).catch(() => {});
}

export async function onDownloadCreated(item: Browser.downloads.DownloadItem) {
  await watchedReady;
  if (!watchedTabs.size) return;
  const referrerOrigin = originOf(item.referrer);
  const flow = await updateFlows((flows) => {
    // DownloadItem has no tabId. Match by the requests seen in the tab, then by the
    // page it came from, then (no referrer at all) by being the only flow waiting.
    const waiting = Object.values(flows).filter((f) => f.downloadId === undefined);
    const match =
      waiting.find((f) => f.requests[item.url] || f.requests[item.finalUrl]) ??
      waiting.find((f) => referrerOrigin && f.pageOrigins.includes(referrerOrigin)) ??
      (!item.referrer && waiting.length === 1 ? waiting[0] : undefined);
    if (match) match.downloadId = item.id;
    return match && structuredClone(match);
  });
  if (!flow) return;

  // blob:/data: downloads are built inside the page; there's nothing we can refetch.
  if (/^(blob|data):/i.test(item.url)) {
    await endFlow(flow.jobId);
    await needFile(
      flow.jobId,
      "This site builds the file inside the page, so EasyMirror can't fetch it itself. Let the download finish, then choose the file.",
    );
    return;
  }

  // Pause rather than cancel: if our own fetch can't get the file (single-use
  // link), we resume and let the browser finish its download instead.
  await browser.downloads.pause(item.id).catch(() => {});
  const seen = flow.requests[item.url] ?? flow.requests[item.finalUrl];
  const source: FetchSpec = { url: item.url, method: seen?.method, form: seen?.form };
  await patchJob(flow.jobId, (j) => (j.sourceUrl ??= item.url));
  await startTransfer({ id: flow.jobId, name: flow.name, source, uploads: flow.uploads, confirmSource: true });
}

/** A watched tab closed before the user started a download: that job can't finish. */
export async function onTabRemoved(tabId: number) {
  await watchedReady;
  if (!watchedTabs.has(tabId)) return;
  const closed = await updateFlows((flows) => {
    const gone = Object.values(flows).filter((f) => f.tabId === tabId && f.downloadId === undefined);
    for (const f of gone) delete flows[f.jobId];
    return gone;
  });
  for (const f of closed) {
    const job = await patchJob(f.jobId, (j) => {
      j.status = 'error';
      j.error = 'The page was closed before a download started.';
    });
    await maybeFinish(job);
  }
}

/** Records the requests of watched tabs, so a download started by a form can be replayed. */
export function onRequest(details: Browser.webRequest.OnBeforeRequestDetails) {
  if (details.tabId < 0) return;
  void watchedReady.then(() => {
    if (!watchedTabs.has(details.tabId)) return;
    return updateFlows((flows) => {
      const flow = Object.values(flows).find((f) => f.tabId === details.tabId && f.downloadId === undefined);
      if (!flow) return;
      flow.requests[details.url] = {
        method: details.method as FetchSpec['method'],
        form: details.requestBody?.formData as FetchSpec['form'],
      };
      const origin = originOf(details.url);
      if (details.type === 'main_frame' && origin && !flow.pageOrigins.includes(origin)) flow.pageOrigins.push(origin);
    });
  });
}
