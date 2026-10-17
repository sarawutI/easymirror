// Real-site check: mirrors one tiny text file through the release build's popup to the
// hosts you name, and prints the share links. This uploads to the REAL sites.
//
//   npm run real-upload -- gofile,fileditch,onefichier
//
// Hosts that need an account read their API key from .env.local (git-ignored), e.g.
// EM_PIXELDRAIN_KEY=... (see .env.example). Keys go into the test browser only.
//
// Uses a copy of the release build whose manifest grants <all_urls> up front (the
// headless browser can't click the permission prompt); the code itself is unchanged.
import { chromium } from 'playwright';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const hosts = (process.argv[2] ?? '').split(',').filter(Boolean);
if (!hosts.length) {
  console.error('Name the hosts to try, e.g.: npm run real-upload -- gofile,fileditch');
  process.exit(1);
}

/** Host id -> the .env.local variable holding its API key. */
const KEY_VARS = {
  pixeldrain: 'EM_PIXELDRAIN_KEY',
  clicknupload: 'EM_CLICKNUPLOAD_KEY',
  sendnow: 'EM_SENDNOW_KEY',
  dailyuploads: 'EM_DAILYUPLOADS_KEY',
  hexupload: 'EM_HEXUPLOAD_KEY',
};
const env = existsSync('.env.local')
  ? Object.fromEntries(
      readFileSync('.env.local', 'utf8')
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]),
    )
  : {};
const accounts = {};
for (const host of hosts) {
  const name = KEY_VARS[host];
  if (!name) continue;
  if (!env[name]) {
    console.error(`${host} needs its API key: add ${name}=... to .env.local`);
    process.exit(1);
  }
  accounts[`accounts.${host}`] = { secret: env[name], label: 'real-upload test' };
}

const build = path.resolve('.output/chrome-mv3');
if (!existsSync(build)) {
  console.error('No release build; run npm run build first.');
  process.exit(1);
}
const work = mkdtempSync(path.join(tmpdir(), 'em-real-'));
const ext = path.join(work, 'ext');
cpSync(build, ext, { recursive: true });
const manifestPath = path.join(ext, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.host_permissions.push('<all_urls>');
delete manifest.optional_host_permissions;
writeFileSync(manifestPath, JSON.stringify(manifest));

const TEXT = `EasyMirror test upload, ${new Date().toISOString().slice(0, 10)}. This tiny file checks that uploads work. Safe to delete.\n`;
const NAME = 'easymirror-test.txt';
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(TEXT), 'Content-Disposition': `attachment; filename="${NAME}"` });
  res.end(TEXT);
}).listen(8799, '127.0.0.1');

const ctx = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  if (Object.keys(accounts).length) {
    await page.evaluate((a) => chrome.storage.local.set(a), accounts);
    await page.reload();
  }
  await page.locator('#destinations input').first().waitFor();
  for (const box of await page.locator('#destinations input').all()) {
    const on = hosts.includes(await box.getAttribute('value'));
    if ((await box.isChecked()) !== on) await box.click();
  }
  await page.fill('#url', `http://127.0.0.1:8799/${NAME}`);
  await page.click('#mirror');
  const deadline = Date.now() + 180_000;
  let job;
  for (;;) {
    job = await page.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      return Object.entries(all).filter(([k]) => k.startsWith('job:')).map(([, v]) => v)[0];
    });
    const settled = job && ['done', 'error'].includes(job.status) && Object.values(job.uploads).every((u) => u.done);
    if (settled || Date.now() > deadline) break;
    await page.waitForTimeout(500);
  }
  console.log('job status:', job?.status, job?.error ?? '');
  for (const [host, u] of Object.entries(job?.uploads ?? {})) {
    console.log(`${host}: ${u.link ?? `ERROR ${u.error ?? u.skipped ?? 'not finished'}`}`);
    if (!u.link) console.log(`   HTTP ${u.status ?? '-'} answer: ${String(u.response ?? '').slice(0, 300)}`);
  }
} finally {
  await ctx.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
