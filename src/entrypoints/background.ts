// Background: wires browser events to the job lifecycle (background/jobs.ts) and the
// page flow (background/flows.ts). The transfer itself runs in the engine.
import { onDownloadCreated, onRequest, onTabRemoved, openPageFlow, watchTab } from '@/background/flows';
import {
  cancelJob,
  handleEngineEvent,
  newJob,
  recoverInterrupted,
  retryJob,
  startMirror,
  startPicked,
  startTransfer,
  updateBadge,
} from '@/background/jobs';
import type { EngineEvent } from '@/engine/types';
import { getSettings, patchJob } from '@/jobs/store';
import type { BackgroundReply, BackgroundRequest } from '@/messages';

const MENU_LINK = 'mirror-link';
const MENU_PAGE = 'mirror-page';
const ALL_SITES = { origins: ['<all_urls>'] };
const TEST = import.meta.env.MODE === 'spike';

/** Answers a message from an extension page. */
async function handleRequest(msg: BackgroundRequest): Promise<BackgroundReply | undefined> {
  switch (msg.type) {
    case 'mirror':
      return { ok: true, id: await startMirror(msg.url, msg.destinations) };
    case 'watch-tab': {
      const id = await newJob(msg.destinations, (j) => (j.sourceUrl = msg.pageUrl));
      await watchTab(id, msg.tabId, msg.pageUrl);
      return { ok: true, id };
    }
    case 'picked':
      await startPicked(msg.id, msg.info);
      return { ok: true };
    case 'cancel-job':
      await cancelJob(msg.id);
      return { ok: true };
    case 'retry-job':
      await retryJob(msg.id);
      return { ok: true };
    case 'jobs-changed':
      await updateBadge();
      return { ok: true };
  }
  if (!TEST) return undefined;
  // Test builds only: hooks for spikes/run-spikes.mjs and the e2e tests.
  switch (msg.type) {
    case 'start-transfer': {
      const job = msg.job;
      await patchJob(job.id, (j) => {
        j.status = 'queued';
        for (const u of job.uploads ?? []) j.uploads[u.label] = { sent: 0, done: false };
      });
      await startTransfer(job);
      return { ok: true };
    }
    case 'start-pageflow':
      await openPageFlow(msg.jobId, msg.pageUrl, { name: msg.name, uploads: msg.uploads });
      return { ok: true };
    case 'simulate-startup':
      await recoverInterrupted();
      return { ok: true };
  }
  return undefined;
}

export default defineBackground({
  // Firefox's build (Manifest V2) runs transfers in the background page; keep it loaded
  // so a long one is never cut off. Chrome ignores this (its engine is offscreen).
  persistent: true,
  main() {
    browser.runtime.onInstalled.addListener(async () => {
      // Start clean so an update or reload never trips over duplicate ids.
      await browser.contextMenus.removeAll();
      browser.contextMenus.create({ id: MENU_LINK, title: 'Mirror with EasyMirror', contexts: ['link'] });
      browser.contextMenus.create({ id: MENU_PAGE, title: 'Mirror the next download on this page', contexts: ['page'] });
      // An update or reload stops any running transfer.
      await recoverInterrupted();
    });
    browser.runtime.onStartup.addListener(() => void recoverInterrupted());

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

    browser.tabs.onRemoved.addListener((tabId) => void onTabRemoved(tabId));

    browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
      const answer: Promise<unknown> | undefined =
        msg?.target === 'background' ? handleEngineEvent(msg as EngineEvent) : msg?.target ? undefined : handleRequest(msg as BackgroundRequest);
      if (!answer) return;
      answer.then(sendResponse, (e) => sendResponse({ ok: false, error: String((e as Error)?.message ?? e) }));
      return true;
    });

    // Non-blocking webRequest is allowed in MV3 and still exposes form bodies.
    browser.webRequest.onBeforeRequest.addListener(
      (details): undefined => void onRequest(details),
      { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'other'] },
      ['requestBody'],
    );

    browser.downloads.onCreated.addListener((item) => void onDownloadCreated(item));
  },
});
