import { formatBytes } from '@/engine/filename';
import { copyToTemp } from '@/engine/transfer';
import type { JobState, UploadState } from '@/engine/types';
import { destinationById, destinations } from '@/hosts';
import type { DestinationId } from '@/hosts/types';
import { getJob, getSettings, isFinished, isJobKey, listJobs, removeJobs, saveSettings, summarize } from '@/jobs/store';
import { DONATE } from '@/links';

const ALL_SITES = { origins: ['<all_urls>'] };
const MAX_JOBS_SHOWN = 20;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('mirror-form');
const urlInput = $<HTMLInputElement>('url');
const destBox = $<HTMLDivElement>('destinations');
const formError = $<HTMLParagraphElement>('form-error');
const permissionHint = $<HTMLParagraphElement>('permission-hint');
const mirrorButton = $<HTMLButtonElement>('mirror');
const watchButton = $<HTMLButtonElement>('watch');
const pickSection = $<HTMLElement>('pick');
const pickDetail = $<HTMLParagraphElement>('pick-detail');
const pickInput = $<HTMLInputElement>('pick-file');
const pickStatus = $<HTMLParagraphElement>('pick-status');
const jobsList = $<HTMLUListElement>('jobs');
const emptyHint = $<HTMLParagraphElement>('empty');
const clearButton = $<HTMLButtonElement>('clear');

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c) el.append(c);
  return el;
}

// --- Form ---------------------------------------------------------------------

function showError(text?: string) {
  formError.hidden = !text;
  formError.textContent = text ?? '';
}

function selectedDestinations(): DestinationId[] {
  return [...destBox.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value as DestinationId);
}

function settingsLink(text: string) {
  const a = h('a', { href: '#', className: 'inline-link', textContent: text });
  a.addEventListener('click', (e) => {
    e.preventDefault();
    void browser.runtime.openOptionsPage();
  });
  return a;
}

async function renderDestinations() {
  const { destinations: chosen } = await getSettings();
  const connected = await Promise.all(destinations.map((d) => d.connected()));
  const ready = destinations.filter((_, i) => connected[i]);
  // Hosts that need the user's account are only named, in one line, until it's connected.
  const waiting = destinations.filter((_, i) => !connected[i]);
  const more =
    waiting.length > 0 &&
    h(
      'p',
      { className: 'dest-more' },
      `With your own account: ${waiting.map((d) => d.label).join(', ')} · `,
      settingsLink('Set up in Settings'),
    );
  destBox.replaceChildren(
    h(
      'div',
      { className: 'dest-grid' },
      ...ready.map((d) =>
        h(
          'label',
          { className: 'dest' },
          h('input', { type: 'checkbox', value: d.id, checked: chosen.includes(d.id) }),
          h('span', {}, d.label, h('span', { className: 'dest-note' }, d.note)),
        ),
      ),
    ),
    ...(more ? [more] : []),
  );
}

// Accounts change on the settings page; refresh which hosts can be picked.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('accounts.'))) void renderDestinations();
});

destBox.addEventListener('change', () => {
  const chosen = selectedDestinations();
  if (chosen.length) void saveSettings({ destinations: chosen });
});

function parseLink(raw: string): URL | undefined {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError();
  const url = parseLink(urlInput.value);
  if (!url) return showError('Paste a link that starts with http:// or https://');
  const chosen = selectedDestinations();
  if (!chosen.length) return showError('Pick at least one place to mirror to.');

  // Must start inside the click handler (user gesture), before any other await.
  const permission = browser.permissions.request(ALL_SITES).catch(() => false);
  mirrorButton.disabled = true;
  try {
    if (!(await permission)) {
      return showError("EasyMirror can't read the file without permission to access other sites.");
    }
    permissionHint.hidden = true;
    const res = (await browser.runtime.sendMessage({ type: 'mirror', url: url.href, destinations: chosen })) as
      | { ok: boolean; error?: string }
      | undefined;
    if (!res?.ok) return showError(res?.error ?? 'Something went wrong starting the mirror.');
    urlInput.value = '';
  } finally {
    mirrorButton.disabled = false;
  }
});

// For hosts that hide the file link: catch the next download in the current tab.
watchButton.addEventListener('click', async () => {
  showError();
  const chosen = selectedDestinations();
  if (!chosen.length) return showError('Pick at least one place to mirror to.');
  const permission = browser.permissions.request(ALL_SITES).catch(() => false);
  watchButton.disabled = true;
  try {
    if (!(await permission)) {
      return showError("EasyMirror can't read the file without permission to access other sites.");
    }
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !/^https?:/.test(tab.url ?? '')) {
      return showError("Open the host's download page first, then press this button there.");
    }
    const res = (await browser.runtime.sendMessage({ type: 'watch-tab', tabId: tab.id, pageUrl: tab.url, destinations: chosen })) as
      | { ok: boolean; error?: string }
      | undefined;
    if (!res?.ok) return showError(res?.error ?? 'Something went wrong.');
    window.close(); // out of the way, so the user can click the page's download button
  } finally {
    watchButton.disabled = false;
  }
});

// --- Choose the downloaded file (fallback) --------------------------------------

const pickJobId = new URLSearchParams(location.search).get('pick');

async function setUpPicker(id: string) {
  const job = await getJob(id);
  form.hidden = true;
  pickSection.hidden = false;
  pickDetail.textContent = job?.sourceUrl
    ? `Pick the file your browser downloaded from ${new URL(job.sourceUrl).hostname}. It's usually in your Downloads folder.`
    : "Pick the file your browser downloaded. It's usually in your Downloads folder.";
}

pickInput.addEventListener('change', async () => {
  const file = pickInput.files?.[0];
  if (!file || !pickJobId) return;
  pickInput.disabled = true;
  pickStatus.textContent = `Preparing ${file.name}…`;
  try {
    // The engine runs in another page of this extension; it reads the copy from
    // the extension's private storage (a File can't be sent in a message).
    await copyToTemp(file, `${pickJobId}.part`);
    await browser.runtime.sendMessage({
      type: 'picked',
      id: pickJobId,
      info: { name: file.name, size: file.size, type: file.type || undefined },
    });
    pickStatus.textContent = 'Uploading. Progress is shown below; you can close this tab once the links appear.';
  } catch (e) {
    pickStatus.textContent = `Couldn't read that file: ${String((e as Error).message ?? e)}`;
    pickInput.disabled = false;
  }
});

function openReport(jobId?: string) {
  const query = jobId ? `?job=${encodeURIComponent(jobId)}` : '';
  void browser.tabs.create({ url: browser.runtime.getURL(`/report.html${query}`) });
}

function openPicker(id: string) {
  void browser.tabs.create({ url: browser.runtime.getURL(`/popup.html?pick=${encodeURIComponent(id)}`) });
}

// --- Jobs ---------------------------------------------------------------------

function jobTitle(job: JobState) {
  if (job.name) return job.name;
  try {
    const u = new URL(job.sourceUrl ?? '');
    return u.hostname + u.pathname;
  } catch {
    return job.sourceUrl ?? 'File';
  }
}

function jobProgress(job: JobState): { text: string; value?: number; isError?: boolean; isAction?: boolean } {
  switch (job.status) {
    case 'queued':
      return { text: 'Starting…' };
    case 'waiting-for-user':
      return {
        text:
          job.pageMode === 'watching'
            ? 'Waiting: click the download button on that page'
            : 'This link is a download page. Click the download button on the page that opened.',
        isAction: true,
      };
    case 'fallback-needed':
      return { text: job.error ?? 'Choose the downloaded file to finish.', isAction: true };
    case 'downloading':
      return job.total
        ? { text: `Downloading ${formatBytes(job.downloaded)} of ${formatBytes(job.total)}`, value: job.downloaded / job.total }
        : { text: `Downloading ${formatBytes(job.downloaded)}` };
    case 'uploading': {
      const size = job.size ?? job.total ?? 0;
      const active = Object.values(job.uploads).filter((u) => !u.skipped && !u.error);
      const sent = active.length ? Math.min(...active.map((u) => (u.done ? size : u.sent))) : 0;
      return { text: size ? `Uploading ${formatBytes(size)}` : 'Uploading…', value: size ? sent / size : undefined };
    }
    case 'done':
      return { text: summarize(job), isError: !Object.values(job.uploads).some((u) => u.link) };
    default:
      return { text: job.error ?? summarize(job), isError: true };
  }
}

function copyButton(text: string, label = 'Copy') {
  const button = h('button', { type: 'button', className: 'copy', textContent: label });
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = label), 1200);
  });
  return button;
}

function uploadRow(destId: string, up: UploadState, job: JobState) {
  const name = destinationById(destId)?.label ?? destId;
  let detail: HTMLElement;
  if (up.link) {
    detail = h('span', { className: 'upload-detail ok' }, h('a', { href: up.link, target: '_blank', rel: 'noopener', textContent: up.link }));
  } else if (up.skipped) {
    detail = h('span', { className: 'upload-detail skipped', textContent: up.skipped });
  } else if (up.error) {
    detail = h('span', { className: 'upload-detail error', textContent: up.error });
  } else if (job.status === 'uploading') {
    const size = job.size ?? 0;
    detail = h('span', { className: 'upload-detail', textContent: size ? `${Math.floor((up.sent / size) * 100)}%` : 'Uploading…' });
  } else {
    detail = h('span', { className: 'upload-detail', textContent: isFinished(job) ? 'Not uploaded' : 'Waiting' });
  }
  return h('li', { className: 'upload' }, h('span', { className: 'upload-name', textContent: name }), detail, up.link && copyButton(up.link));
}

function jobCard(job: JobState) {
  const progress = jobProgress(job);
  const links = Object.values(job.uploads)
    .map((u) => u.link)
    .filter((l): l is string => !!l);
  const moving = job.status === 'queued' || job.status === 'downloading' || job.status === 'uploading';
  const bar = moving && h('progress', { max: 1, ...(progress.value !== undefined ? { value: progress.value } : {}) });
  // Chrome storage hands keys back sorted, so restore the checkbox order.
  const order = (id: string) => destinations.findIndex((d) => d.id === id);
  const rows = Object.entries(job.uploads).sort(([a], [b]) => order(a) - order(b));
  // Until there's a file, per-destination rows add nothing.
  const showRows = job.status !== 'error' && job.status !== 'fallback-needed';
  const actions: HTMLElement[] = [];
  if (job.status === 'waiting-for-user') {
    const cancel = h('button', { type: 'button', className: 'copy', textContent: 'Cancel' });
    cancel.addEventListener('click', () => void browser.runtime.sendMessage({ type: 'cancel-job', id: job.id }));
    actions.push(cancel);
  }
  if (job.status === 'fallback-needed' && job.id !== pickJobId) {
    const choose = h('button', { type: 'button', className: 'copy', textContent: 'Choose the downloaded file' });
    choose.addEventListener('click', () => openPicker(job.id));
    actions.push(choose);
  }
  const failed = job.status === 'error' || (job.status === 'done' && Object.values(job.uploads).some((u) => u.error));
  if (failed && job.error !== 'Cancelled') {
    const report = h('button', { type: 'button', className: 'copy', textContent: 'Report this problem' });
    report.addEventListener('click', () => openReport(job.id));
    actions.push(report);
  }
  if (links.length > 1) actions.push(copyButton(links.join('\n'), 'Copy all links'));
  const statusClass = progress.isError ? ' error' : progress.isAction ? ' action' : '';
  return h(
    'li',
    { className: 'job' },
    h('div', { className: 'job-title', textContent: jobTitle(job), title: job.sourceUrl ?? '' }),
    h('div', { className: `job-status${statusClass}`, textContent: progress.text }),
    bar,
    showRows && h('ul', { className: 'uploads' }, ...rows.map(([id, up]) => uploadRow(id, up, job))),
    actions.length > 0 && h('div', { className: 'job-actions' }, ...actions),
  );
}

async function renderJobs() {
  const jobs = (await listJobs()).slice(0, MAX_JOBS_SHOWN);
  jobsList.replaceChildren(...jobs.map(jobCard));
  emptyHint.hidden = jobs.length > 0;
  clearButton.hidden = !jobs.some(isFinished);
}

clearButton.addEventListener('click', async () => {
  await removeJobs((await listJobs()).filter(isFinished).map((j) => j.id));
  await browser.runtime.sendMessage({ type: 'jobs-changed' }).catch(() => {});
});

// Progress arrives several times a second; batch renders. A timer rather than
// requestAnimationFrame, which stops firing while this page is a background tab.
const RENDER_DELAY_MS = 100;
let renderQueued = false;
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some(isJobKey) || renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    void renderJobs();
  }, RENDER_DELAY_MS);
});

// --- Start ----------------------------------------------------------------------

const params = new URLSearchParams(location.search);
if (params.size) document.body.classList.add('in-tab');
const prefill = params.get('url');
if (prefill) urlInput.value = prefill;

document.getElementById('open-settings')!.addEventListener('click', () => void browser.runtime.openOptionsPage());
document.getElementById('report-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  openReport();
});
if (DONATE) {
  const donate = $<HTMLAnchorElement>('donate-link');
  donate.href = DONATE;
  donate.hidden = false;
}
if (pickJobId) void setUpPicker(pickJobId);
void browser.permissions.contains(ALL_SITES).then((granted) => (permissionHint.hidden = granted));
void renderDestinations();
void renderJobs();
if (!prefill) urlInput.focus();
