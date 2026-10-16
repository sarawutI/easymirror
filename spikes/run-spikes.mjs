// Runs the M0 spikes against the built extension in Playwright's Chromium.
//   npm run build:spike && npm run spike:run
// Env: SIZES=comma-separated byte counts (default 100 MB, 1 GB, 5 GB)
//      ONLY=transfer|pageflow
import { chromium } from 'playwright';
import { spawn, exec } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const MB = 1024 * 1024;
const SIZES = (process.env.SIZES ?? `${100 * MB},${1024 * MB},${5 * 1024 * MB}`).split(',').map(Number);
const ONLY = process.env.ONLY;

const outRoot = path.resolve('.output');
const extDir = readdirSync(outRoot).find((d) => d.startsWith('chrome-mv3') && d.includes('spike')) ?? 'chrome-mv3';
const extPath = path.join(outRoot, extDir);

const fmt = (b) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(2)} GB` : `${(b / MB).toFixed(1)} MB`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Memory sampler: total working set of all chrome.exe processes -----------
let peakBrowserMem = 0;
let baselineBrowserMem = 0;
function sampleBrowserMem() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH', (err, out) => {
      if (err) return resolve(0);
      const kb = out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => Number(line.split('","')[4]?.replace(/[^\d]/g, '') ?? 0))
        .reduce((a, b) => a + b, 0);
      resolve(kb * 1024);
    });
  });
}

async function main() {
  console.log(`extension: ${extPath}`);
  const server = spawn(process.execPath, ['spikes/server.mjs'], { env: { ...process.env, PORT: String(PORT) } });
  server.stderr.pipe(process.stderr);
  await new Promise((r) => server.stdout.once('data', r));

  const profile = mkdtempSync(path.join(tmpdir(), 'easymirror-spike-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  const results = { transfer: [], pageflow: [] };
  let sampler;
  try {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;
    const control = await context.newPage();
    await control.goto(`chrome-extension://${extId}/spike.html`);
    await control.waitForFunction(() => globalThis.spike);
    const cdp = await context.newCDPSession(control);
    await cdp.send('ServiceWorker.enable');

    await sleep(1000);
    baselineBrowserMem = await sampleBrowserMem();
    sampler = setInterval(async () => {
      peakBrowserMem = Math.max(peakBrowserMem, await sampleBrowserMem());
    }, 1000);

    const job = (id) => control.evaluate((id) => globalThis.spike.job(id), id);
    const stats = async () => (await fetch(`${BASE}/stats`)).json();

    async function waitForJob(id, { timeoutMs, onTick }) {
      const start = Date.now();
      let lastLog = 0;
      for (;;) {
        const j = await job(id);
        if (onTick) await onTick(j);
        if (j && ['done', 'error', 'fallback-needed'].includes(j.status)) return j;
        if (Date.now() - lastLog > 5000 && j) {
          lastLog = Date.now();
          const ups = Object.entries(j.uploads).map(([k, u]) => `${k}=${fmt(u.sent)}`).join(' ');
          console.log(`  [${id}] ${j.status} down=${fmt(j.downloaded)}${j.total ? '/' + fmt(j.total) : ''} ${ups}`);
        }
        if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${id}`);
        await sleep(500);
      }
    }

    // --- Spike 1: large files through OPFS, one download -> two uploads ---------
    if (ONLY !== 'pageflow') {
      for (const size of SIZES) {
        const name = `big-${size}.bin`;
        const id = `t-${size}`;
        console.log(`\nTransfer ${fmt(size)} (service worker stopped mid-way)`);
        peakBrowserMem = 0;
        const started = Date.now();
        let stoppedWorker = false;
        await control.evaluate((job) => globalThis.spike.startTransfer(job), {
          id,
          name,
          source: { url: `${BASE}/file?size=${size}&name=${name}` },
          uploads: [
            { label: 'put', kind: 'put', url: `${BASE}/upload/put/${name}` },
            { label: 'multipart', kind: 'multipart', url: `${BASE}/upload/multipart/${name}`, field: 'file' },
          ],
        });
        const final = await waitForJob(id, {
          timeoutMs: Math.max(5 * 60_000, (size / MB) * 1000),
          onTick: async (j) => {
            if (!stoppedWorker && j?.downloaded > size * 0.3) {
              stoppedWorker = true;
              await cdp.send('ServiceWorker.stopAllWorkers');
              console.log('  stopped the service worker');
            }
          },
        });
        const secs = (Date.now() - started) / 1000;
        const s = await stats();
        const src = s.served[name];
        const check = (k) => (s.received[`${k}:${name}`]?.sha256 === src?.sha256 && src ? 'match' : 'MISMATCH');
        const r = {
          size: fmt(size),
          status: final.status,
          error: final.error,
          seconds: Number(secs.toFixed(1)),
          putHash: check('put'),
          multipartHash: check('multipart'),
          uploads: final.uploads,
          workerStopped: stoppedWorker,
          peakEngineHeap: fmt(final.peakHeapBytes ?? 0),
          peakBrowserMem: fmt(peakBrowserMem),
          baselineBrowserMem: fmt(baselineBrowserMem),
        };
        results.transfer.push(r);
        console.log(`  -> ${r.status} in ${r.seconds}s, put ${r.putHash}, multipart ${r.multipartHash}, heap ${r.peakEngineHeap}, browser ${r.peakBrowserMem}`);
      }
    }

    // --- Spike 2: page flow on a fake host -------------------------------------
    if (ONLY !== 'transfer') {
      for (const variant of ['link-multi', 'form-post', 'link-single']) {
        const name = `${variant}.bin`;
        const id = `pf-${variant}`;
        const size = 50 * MB;
        console.log(`\nPage flow: ${variant}`);
        const tabPromise = context.waitForEvent('page');
        await control.evaluate(
          ([id, url, name, uploads]) => globalThis.spike.startPageFlow(id, url, name, uploads),
          [id, `${BASE}/host/page?variant=${variant}&size=${size}&name=${name}`, name, [
            { label: 'put', kind: 'put', url: `${BASE}/upload/put/${name}` },
          ]],
        );
        const tab = await tabPromise;
        let browserDownload;
        tab.on('download', (d) => (browserDownload = d));
        // Stand-in for the user: wait out the countdown, click the button.
        await tab.waitForSelector('#dl', { state: 'visible', timeout: 15_000 });
        await tab.click('#dl');
        const final = await waitForJob(id, { timeoutMs: 120_000 });
        const s = await stats();
        const src = s.served[name];
        const token = Object.values(s.tokens).find((t) => t.name === name);
        let browserDownloadState;
        if (final.status === 'fallback-needed') {
          await sleep(3000);
          const items = await control.evaluate(() => globalThis.spike.downloads({ orderBy: ['-startTime'], limit: 5 }));
          browserDownloadState = items.find((i) => i.filename.endsWith(name) || i.url.includes('/host/dl'))?.state;
          if (!browserDownloadState && browserDownload) browserDownloadState = (await browserDownload.failure()) ?? 'complete (playwright)';
        }
        const r = {
          variant,
          status: final.status,
          error: final.error,
          hash: s.received[`put:${name}`]?.sha256 && s.received[`put:${name}`].sha256 === src?.sha256 ? 'match' : 'n/a',
          serverHits: token?.used,
          rejectedNoCookie: token?.rejectedNoCookie,
          browserDownloadState,
        };
        results.pageflow.push(r);
        console.log(`  -> ${JSON.stringify(r)}`);
      }
    }
  } finally {
    clearInterval(sampler);
    writeFileSync('spikes/results.json', JSON.stringify(results, null, 2));
    await context.close();
    server.kill();
    rmSync(profile, { recursive: true, force: true });
  }
  console.log('\nresults written to spikes/results.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
