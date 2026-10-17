import { formatBytes, formatRate, formatTimeLeft } from '@/engine/filename';
import { copyToTemp } from '@/engine/transfer';
import type { JobState, UploadState } from '@/engine/types';
import { destinationById, destinations } from '@/hosts';
import type { Destination, DestinationId } from '@/hosts/types';
import { getJob, getSettings, isFinished, isJobKey, listJobs, removeJobs, saveSettings, summarize } from '@/jobs/store';
import { DONATE } from '@/links';
import { askBackground } from '@/messages';

const ALL_SITES = { origins: ['<all_urls>'] };
/** Remembers whether the user left the host list open (a convenience; fine to lose). */
const PICKER_OPEN_KEY = 'easymirror.destPickerOpen';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('mirror-form');
const urlInput = $<HTMLInputElement>('url');
const destPicker = $<HTMLDetailsElement>('dest-picker');
const destSummary = $<HTMLSpanElement>('dest-summary');
const destToggle = $<HTMLSpanElement>('dest-toggle');
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
const announcer = $<HTMLParagraphElement>('announce');

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

function setPickerOpen(open: boolean) {
  destPicker.open = open;
}

destPicker.addEventListener('toggle', () => {
  destToggle.textContent = destPicker.open ? 'Done' : 'Change';
  try {
    localStorage.setItem(PICKER_OPEN_KEY, destPicker.open ? '1' : '');
  } catch {
    // storage unavailable: the list just starts closed next time
  }
});

/** The closed picker's one line: which hosts the next mirror goes to. */
function updateSummary() {
  const chosen = selectedDestinations().map((id) => destinationById(id)?.label ?? id);
  destSummary.textContent = chosen.length ? chosen.join(', ') : 'No host picked';
  destSummary.classList.toggle('none', !chosen.length);
}

function destOption(d: Destination, chosen: DestinationId[]) {
  return h(
    'label',
    { className: 'dest' },
    h('input', { type: 'checkbox', value: d.id, checked: chosen.includes(d.id) }),
    h('span', {}, d.label, d.note && h('span', { className: 'dest-note' }, d.note)),
  );
}

async function renderDestinations() {
  const { destinations: chosen } = await getSettings();
  const connected = await Promise.all(destinations.map((d) => d.connected()));
  const ready = destinations.filter((_, i) => connected[i]);
  const open = ready.filter((d) => !d.needsAccount);
  const mine = ready.filter((d) => d.needsAccount);
  // Hosts that need the user's account are only named, in one line, until it's connected.
  const waiting = destinations.filter((_, i) => !connected[i]);
  const group = (title: string, list: Destination[]) =>
    list.length > 0 && [h('p', { className: 'dest-group', textContent: title }), h('div', { className: 'dest-grid' }, ...list.map((d) => destOption(d, chosen)))];
  destBox.replaceChildren(
    ...(group('No account needed', open) || []),
    ...(group('Your accounts', mine) || []),
    ...(waiting.length
      ? [h('p', { className: 'dest-more' }, `Also with your own account: ${waiting.map((d) => d.label).join(', ')} · `, settingsLink('Set up in Settings'))]
      : []),
  );
  updateSummary();
  if (!selectedDestinations().length) setPickerOpen(true);
}

// Accounts change on the settings page; refresh which hosts can be picked.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('accounts.'))) void renderDestinations();
});

destBox.addEventListener('change', () => {
  const chosen = selectedDestinations();
  updateSummary();
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

function needDestination(): DestinationId[] | undefined {
  const chosen = selectedDestinations();
  if (chosen.length) return chosen;
  setPickerOpen(true);
  showError('Pick at least one place to mirror to.');
  return undefined;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError();
  const url = parseLink(urlInput.value);
  if (!url) return showError('Paste a link that starts with http:// or https://');
  const chosen = needDestination();
  if (!chosen) return;

  // Must start inside the click handler (user gesture), before any other await.
  const permission = browser.permissions.request(ALL_SITES).catch(() => false);
  mirrorButton.disabled = true;
  try {
    if (!(await permission)) {
      return showError("EasyMirror can't read the file without permission to access other sites.");
    }
    permissionHint.hidden = true;
    const res = await askBackground({ type: 'mirror', url: url.href, destinations: chosen });
    if (!res.ok) return showError(res.error ?? 'Something went wrong starting the mirror.');
    urlInput.value = '';
  } finally {
    mirrorButton.disabled = false;
  }
});

// For hosts that hide the file link: catch the next download in the current tab.
watchButton.addEventListener('click', async () => {
  showError();
  const chosen = needDestination();
  if (!chosen) return;
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
    const res = await askBackground({ type: 'watch-tab', tabId: tab.id, pageUrl: tab.url, destinations: chosen });
    if (!res.ok) return showError(res.error ?? 'Something went wrong.');
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
    await askBackground({ type: 'picked', id: pickJobId, info: { name: file.name, size: file.size, type: file.type || undefined } });
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

const isRunning = (job: JobState) => job.status === 'queued' || job.status === 'downloading' || job.status === 'uploading';

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
    case 'downloading': {
      const parts = [job.total ? `Downloading ${formatBytes(job.downloaded)} of ${formatBytes(job.total)}` : `Downloading ${formatBytes(job.downloaded)}`];
      if (job.rate) {
        parts.push(formatRate(job.rate));
        if (job.total) parts.push(formatTimeLeft((job.total - job.downloaded) / job.rate));
      }
      return { text: parts.join(' · '), value: job.total ? job.downloaded / job.total : undefined };
    }
    case 'uploading': {
      const size = job.size ?? job.total ?? 0;
      const active = Object.values(job.uploads).filter((u) => !u.skipped && !u.error);
      const sent = active.length ? Math.min(...active.map((u) => (u.done ? size : u.sent))) : 0;
      // The mirror is done when the slowest host is.
      const left = active.filter((u) => !u.done && u.rate).map((u) => (size - u.sent) / u.rate!);
      const text = size ? `Uploading ${formatBytes(size)}${left.length ? ` · ${formatTimeLeft(Math.max(...left))}` : ''}` : 'Uploading…';
      return { text, value: size ? sent / size : undefined };
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

function actionButton(label: string, onClick: () => void) {
  const button = h('button', { type: 'button', className: 'copy', textContent: label });
  button.addEventListener('click', onClick);
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
    const percent = size ? `${Math.floor((up.sent / size) * 100)}%` : 'Uploading…';
    detail = h('span', { className: 'upload-detail', textContent: up.rate ? `${percent} · ${formatRate(up.rate)}` : percent });
  } else {
    detail = h('span', { className: 'upload-detail', textContent: isFinished(job) ? 'Not uploaded' : 'Waiting' });
  }
  return h('li', { className: 'upload' }, h('span', { className: 'upload-name', textContent: name }), detail, up.link && copyButton(up.link));
}

/** Failed or stopped, with a link to start from again. */
function canRetry(job: JobState) {
  if (!job.sourceUrl || !/^https?:/i.test(job.sourceUrl)) return false;
  const uploads = Object.values(job.uploads);
  if (job.status === 'error') return true;
  return job.status === 'done' && uploads.some((u) => u.error);
}

function jobCard(job: JobState) {
  const progress = jobProgress(job);
  const links = Object.values(job.uploads)
    .map((u) => u.link)
    .filter((l): l is string => !!l);
  const bar =
    isRunning(job) &&
    h('progress', {
      max: 1,
      ...(progress.value !== undefined ? { value: progress.value } : {}),
      ariaLabel: job.status === 'downloading' ? 'Download progress' : 'Upload progress',
    });
  // Chrome storage hands keys back sorted, so restore the checkbox order.
  const order = (id: string) => destinations.findIndex((d) => d.id === id);
  const rows = Object.entries(job.uploads).sort(([a], [b]) => order(a) - order(b));
  // Until there's a file, per-destination rows add nothing.
  const showRows = job.status !== 'error' && job.status !== 'fallback-needed';
  const actions: HTMLElement[] = [];
  if (isRunning(job) || job.status === 'waiting-for-user') {
    actions.push(actionButton('Cancel', () => void askBackground({ type: 'cancel-job', id: job.id })));
  }
  if (job.status === 'fallback-needed' && job.id !== pickJobId) {
    actions.push(actionButton('Choose the downloaded file', () => openPicker(job.id)));
  }
  if (canRetry(job)) actions.push(actionButton('Try again', () => void askBackground({ type: 'retry-job', id: job.id })));
  const failed = job.status === 'error' || (job.status === 'done' && Object.values(job.uploads).some((u) => u.error));
  if (failed && !job.cancelled && !job.interrupted) actions.push(actionButton('Report this problem', () => openReport(job.id)));
  if (links.length > 1) actions.push(copyButton(links.join('\n'), 'Copy all links'));

  const title = h('div', { className: 'job-title', textContent: jobTitle(job), title: job.sourceUrl ?? '' });
  let head: HTMLElement = title;
  if (isFinished(job)) {
    const remove = h('button', { type: 'button', className: 'job-remove', textContent: '×', title: 'Remove from list' });
    remove.setAttribute('aria-label', `Remove ${jobTitle(job)} from the list`);
    remove.addEventListener('click', async () => {
      await removeJobs([job.id]);
      await askBackground({ type: 'jobs-changed' }).catch(() => undefined);
    });
    head = h('div', { className: 'job-head' }, title, remove);
  }
  const statusClass = progress.isError ? ' error' : progress.isAction ? ' action' : '';
  return h(
    'li',
    { className: 'job' },
    head,
    h('div', { className: `job-status${statusClass}`, textContent: progress.text }),
    bar,
    showRows && h('ul', { className: 'uploads' }, ...rows.map(([id, up]) => uploadRow(id, up, job))),
    actions.length > 0 && h('div', { className: 'job-actions' }, ...actions),
  );
}

/** Each job's status at the last render, to announce the ones that just finished. */
let lastStatus: Map<string, JobState['status']> | undefined;

function announceFinished(jobs: JobState[]) {
  const seen = lastStatus;
  lastStatus = new Map(jobs.map((j) => [j.id, j.status]));
  if (!seen) return; // the first render announces nothing
  const finished = jobs.filter((j) => isFinished(j) && seen.has(j.id) && !isFinished({ ...j, status: seen.get(j.id)! }));
  if (finished.length) announcer.textContent = finished.map((j) => `${jobTitle(j)}: ${jobProgress(j).text}`).join('. ');
}

async function renderJobs() {
  const jobs = await listJobs();
  jobsList.replaceChildren(...jobs.map(jobCard));
  emptyHint.hidden = jobs.length > 0;
  clearButton.hidden = !jobs.some(isFinished);
  announceFinished(jobs);
}

clearButton.addEventListener('click', async () => {
  await removeJobs((await listJobs()).filter(isFinished).map((j) => j.id));
  await askBackground({ type: 'jobs-changed' }).catch(() => undefined);
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

try {
  if (localStorage.getItem(PICKER_OPEN_KEY)) setPickerOpen(true);
} catch {
  // storage unavailable: start closed
}
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
