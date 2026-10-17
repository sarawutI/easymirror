import type { Browser } from 'wxt/browser';
import type { EngineEvent, FetchSpec, FileInfo, JobState, TransferJob, UploadPlan, UploadSpec, UploadState } from '@/engine/types';
import { destinationById } from '@/hosts';
import { getJob, getSettings, isFinished, listJobs, patchJob, summarize } from '@/jobs/store';

const OFFSCREEN_URL = 'offscreen.html';
const MENU_LINK = 'mirror-link';
const MENU_PAGE = 'mirror-page';
const ALL_SITES = { origins: ['<all_urls>'] };

/**
 * A page-flow job: the file sits behind a host's download page, so we watch a tab
 * until the user clicks "download" there, then take over that download.
 */
interface PageFlow {
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

// The service worker can be stopped at any time, so everything lives in storage.
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

async function startTransfer(job: TransferJob) {
  await ensureOffscreen();
  await browser.runtime.sendMessage({ target: 'offscreen', type: 'transfer', job });
}

async function newJob(destinationIds: string[], init: (j: JobState) => void): Promise<string> {
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
async function startMirror(url: string, destinationIds: string[]): Promise<string> {
  const id = await newJob(destinationIds, (j) => (j.sourceUrl = url));
  await startTransfer({ id, source: { url } });
  return id;
}

/** Called by the engine once the source answers: which destinations get the file? */
async function planUploads(id: string, info: FileInfo): Promise<UploadPlan> {
  const job = await getJob(id);
  const uploads: UploadSpec[] = [];
  const outcome: Record<string, UploadState> = {};
  // Hosts are prepared in parallel; one failing (e.g. signed out) doesn't stop the rest.
  await Promise.all(
    Object.keys(job?.uploads ?? {}).map(async (destId) => {
      const dest = destinationById(destId);
      if (!dest) return;
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

// --- Page flow --------------------------------------------------------------------

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
async function openPageFlow(jobId: string, pageUrl: string, extra: Pick<PageFlow, 'name' | 'uploads'> = {}) {
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
async function watchTab(jobId: string, tabId: number, pageUrl?: string) {
  await updateFlows((flows) => {
    flows[jobId] = { jobId, tabId, openedByUs: false, pageOrigins: [originOf(pageUrl)].filter((o): o is string => !!o), requests: {} };
  });
  await patchJob(jobId, (j) => {
    j.status = 'waiting-for-user';
    j.pageMode = 'watching';
  });
  await hint(jobId, 'Click the download button on this page. EasyMirror will mirror that file.');
}

async function endFlow(jobId: string): Promise<PageFlow | undefined> {
  return updateFlows((flows) => {
    const f = flows[jobId];
    delete flows[jobId];
    return f;
  });
}

async function needFile(jobId: string, error: string) {
  const job = await patchJob(jobId, (j) => {
    j.status = 'fallback-needed';
    j.error = error;
  });
  await maybeFinish(job);
}

async function onDownloadCreated(item: Browser.downloads.DownloadItem) {
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

// --- Finishing ------------------------------------------------------------------------

async function updateBadge() {
  const active = (await listJobs()).filter((j) => !isFinished(j)).length;
  await browser.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await browser.action.setBadgeText({ text: active ? String(active) : '' });
}

/** Notifies once, when the transfer and every upload have settled. */
async function maybeFinish(job: JobState) {
  const uploadsSettled = Object.values(job.uploads).every((u) => u.done);
  if (!isFinished(job) || (job.status === 'done' && !uploadsSettled)) return;
  let first = false;
  await patchJob(job.id, (j) => {
    first = !j.notified;
    j.notified = true;
  });
  if (!first) return;
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

async function handleEngineEvent(ev: EngineEvent): Promise<unknown> {
  if (ev.type === 'plan-uploads') return planUploads(ev.id, ev.info);
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
        patch.link = await dest.parseResponse(patch.status ?? 0, patch.response ?? '', meta);
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
      await browser.downloads.cancel(flow.downloadId).catch(() => {});
      await browser.downloads.erase({ id: flow.downloadId }).catch(() => {});
      if (flow.openedByUs) await browser.tabs.remove(flow.tabId).catch(() => {});
    } else {
      await browser.downloads.resume(flow.downloadId).catch(() => {});
      await needFile(
        ev.id,
        `EasyMirror couldn't fetch the file again (${ev.error}), so your browser is downloading it instead. When it finishes, choose the file.`,
      );
    }
  }
}

/** Uploads a file the user picked (the page already copied it to temp storage). */
async function startPicked(id: string, info: FileInfo) {
  await patchJob(id, (j) => {
    j.status = 'queued';
    j.error = undefined;
    j.notified = false;
    for (const k of Object.keys(j.uploads)) j.uploads[k] = { sent: 0, done: false };
  });
  await updateBadge();
  await startTransfer({ id, picked: info });
}

async function cancelJob(id: string) {
  await endFlow(id);
  const job = await getJob(id);
  if (!job || isFinished(job) || job.status !== 'waiting-for-user') return;
  await patchJob(id, (j) => {
    j.status = 'error';
    j.error = 'Cancelled';
    j.notified = true;
  });
  await browser.notifications.clear(`${id}:hint`).catch(() => {});
  await updateBadge();
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    // Start clean so an update or reload never trips over duplicate ids.
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({ id: MENU_LINK, title: 'Mirror with EasyMirror', contexts: ['link'] });
    browser.contextMenus.create({ id: MENU_PAGE, title: 'Mirror the next download on this page', contexts: ['page'] });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_LINK && info.menuItemId !== MENU_PAGE) return;
    // Reading files from arbitrary sites needs the optional all-sites permission.
    // A menu click is a user gesture, but only until the first await, so ask first;
    // when it's already granted this resolves at once without a prompt.
    const allowed = await browser.permissions.request(ALL_SITES).catch(() => false);
    if (!allowed) {
      // Fall back to the popup page, which explains the permission and asks again.
      const query = info.linkUrl ? `?url=${encodeURIComponent(info.linkUrl)}` : '?tab=1';
      await browser.tabs.create({ url: browser.runtime.getURL(`/popup.html${query}`) });
      return;
    }
    const { destinations } = await getSettings();
    if (info.menuItemId === MENU_LINK && info.linkUrl) {
      await startMirror(info.linkUrl, destinations);
    } else if (info.menuItemId === MENU_PAGE && tab?.id !== undefined) {
      const id = await newJob(destinations, (j) => (j.sourceUrl = info.pageUrl ?? tab.url));
      await watchTab(id, tab.id, info.pageUrl ?? tab.url);
    }
  });

  browser.notifications.onClicked.addListener(async (id) => {
    await browser.notifications.clear(id);
    if (!id.endsWith(':hint')) await browser.tabs.create({ url: browser.runtime.getURL('/popup.html?tab=1') });
  });

  browser.tabs.onRemoved.addListener(async (tabId) => {
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
  });

  browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    const reply = (p: Promise<unknown>) => {
      p.then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    };
    if (msg?.target === 'background') return reply(handleEngineEvent(msg as EngineEvent));
    if (msg?.type === 'mirror') return reply(startMirror(msg.url, msg.destinations).then((id) => ({ ok: true, id })));
    if (msg?.type === 'watch-tab') {
      return reply(
        newJob(msg.destinations, (j) => (j.sourceUrl = msg.pageUrl))
          .then(async (id) => (await watchTab(id, msg.tabId, msg.pageUrl), id))
          .then((id) => ({ ok: true, id })),
      );
    }
    if (msg?.type === 'picked') return reply(startPicked(msg.id, msg.info).then(() => ({ ok: true })));
    if (msg?.type === 'cancel-job') return reply(cancelJob(msg.id).then(() => ({ ok: true })));
    if (msg?.type === 'jobs-changed') return reply(updateBadge().then(() => ({ ok: true })));
    // Spike runner hooks (spikes/run-spikes.mjs).
    if (msg?.type === 'start-transfer') {
      const job = msg.job as TransferJob;
      return reply(
        patchJob(job.id, (j) => {
          j.status = 'queued';
          for (const u of job.uploads ?? []) j.uploads[u.label] = { sent: 0, done: false };
        })
          .then(() => startTransfer(job))
          .then(() => ({ ok: true })),
      );
    }
    if (msg?.type === 'start-pageflow') {
      return reply(openPageFlow(msg.jobId, msg.pageUrl, { name: msg.name, uploads: msg.uploads }).then(() => ({ ok: true })));
    }
  });

  // Non-blocking webRequest is allowed in MV3 and still exposes form bodies.
  browser.webRequest.onBeforeRequest.addListener(
    (details): undefined => {
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
    },
    { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'other'] },
    ['requestBody'],
  );

  browser.downloads.onCreated.addListener((item) => void onDownloadCreated(item));
});
