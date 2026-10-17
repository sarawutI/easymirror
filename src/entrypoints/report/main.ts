import { buildDetails } from '@/feedback/details';
import { destinationById, destinations } from '@/hosts';
import { listJobs } from '@/jobs/store';
import { FEEDBACK_FORM, feedbackUrl } from '@/links';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const includeDetails = $<HTMLInputElement>('include-details');
const includeNames = $<HTMLInputElement>('include-names');
const pre = $<HTMLPreElement>('details');
const openForm = $<HTMLButtonElement>('open-form');
const copy = $<HTMLButtonElement>('copy');
const status = $<HTMLParagraphElement>('status');

/** Set by "Report this problem" on a failed mirror. */
const jobId = new URLSearchParams(location.search).get('job') ?? undefined;

let details = '';

async function render() {
  const [jobs, ready] = await Promise.all([listJobs(), Promise.all(destinations.map((d) => d.connected()))]);
  details = buildDetails(
    {
      version: browser.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      hosts: destinations.map((d, i) => ({ label: d.label, ready: ready[i]! })),
      jobs,
      hostLabel: (id) => destinationById(id)?.label ?? id,
    },
    { includeNames: includeNames.checked, jobId },
  );
  pre.textContent = details;
  pre.classList.toggle('off', !includeDetails.checked);
  includeNames.disabled = !includeDetails.checked;
}

const chosenDetails = () => (includeDetails.checked ? details : '');

copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(details);
  status.textContent = 'Copied.';
});

openForm.addEventListener('click', async () => {
  const url = feedbackUrl(chosenDetails());
  if (!url) return;
  // A form without a details field: hand the details over through the clipboard.
  if (includeDetails.checked && !FEEDBACK_FORM.includes('{details}')) {
    await navigator.clipboard.writeText(details).catch(() => {});
    $('paste-hint').hidden = false;
  }
  await browser.tabs.create({ url });
});

includeDetails.addEventListener('change', () => void render());
includeNames.addEventListener('change', () => void render());

if (!FEEDBACK_FORM) {
  openForm.disabled = true;
  $('no-form').hidden = false;
}
void render();
