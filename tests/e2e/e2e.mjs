// End-to-end tests: drives the real popup against mock GoFile/Catbox endpoints.
//   npm run build:spike && npm run test:e2e
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const MB = 1024 * 1024;

const outRoot = path.resolve('.output');
const extPath = path.join(outRoot, readdirSync(outRoot).find((d) => d.startsWith('chrome-mv3') && d.includes('spike')));

const server = spawn(process.execPath, ['spikes/server.mjs'], { env: { ...process.env, PORT: String(PORT) } });
server.stderr.pipe(process.stderr);
await new Promise((r) => server.stdout.once('data', r));

const profile = mkdtempSync(path.join(tmpdir(), 'easymirror-e2e-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

const stats = async () => (await fetch(`${BASE}/stats`)).json();
const results = [];
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    results.push(`  ✗ ${name}\n      ${String(e.message ?? e).split('\n').join('\n      ')}`);
  }
}

try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);

  /** Mirrors a link through the popup UI and returns the finished job card's text. */
  /** Ticks exactly `destinations` (hosts without a connected account can't be ticked). */
  async function choose(destinations) {
    for (const box of await popup.locator('#destinations input').all()) {
      if (await box.isDisabled()) continue;
      const want = destinations.includes(await box.getAttribute('value'));
      if ((await box.isChecked()) !== want) await box.click();
    }
  }

  async function mirror(link, { destinations = ['gofile', 'catbox'] } = {}) {
    await choose(destinations);
    const before = await popup.locator('#jobs > .job').count();
    await popup.fill('#url', link);
    await popup.click('#mirror');
    await popup.waitForFunction((n) => document.querySelectorAll('#jobs > .job').length > n, before, { timeout: 10_000 });
    const card = popup.locator('#jobs > .job').first();
    await settledCard(['done', 'error']);
    return {
      status: await card.locator('.job-status').innerText(),
      uploads: Object.fromEntries(
        await card.locator('.upload').evaluateAll((rows) =>
          rows.map((r) => [r.querySelector('.upload-name').textContent, r.querySelector('.upload-detail').textContent]),
        ),
      ),
      copyAll: await card.getByRole('button', { name: 'Copy all links' }).count(),
    };
  }

  await test('mirrors a direct link to GoFile and Catbox, file arrives intact', async () => {
    const r = await mirror(`${BASE}/file/report.pdf?size=${5 * MB}`);
    assert.equal(r.status, '2 links ready');
    assert.match(r.uploads.GoFile, /^https:\/\/gofile\.io\/d\//);
    assert.match(r.uploads.Catbox, /^https:\/\/files\.catbox\.moe\/\w+\.pdf$/);
    assert.equal(r.copyAll, 1);
    const s = await stats();
    assert.equal(s.received['gofile:report.pdf'].sha256, s.served['report.pdf'].sha256);
    assert.equal(s.received['catbox:report.pdf'].sha256, s.served['report.pdf'].sha256);
  });

  await test('reuses the GoFile guest token on the next mirror', async () => {
    await mirror(`${BASE}/file/second.zip?size=${MB}`, { destinations: ['gofile'] });
    const { gofileAuth } = await stats();
    assert.equal(gofileAuth[0], null, 'first upload has no token');
    assert.equal(gofileAuth.at(-1), 'Bearer guest-test-token');
  });

  await test('skips Catbox for a file over 200 MB before downloading, GoFile still gets it', async () => {
    const r = await mirror(`${BASE}/file/movie.mkv?size=${300 * MB}`);
    assert.equal(r.status, '1 of 2 links ready');
    assert.match(r.uploads.Catbox, /Catbox takes files up to 200 MB \(this one is 300 MB\)/);
    assert.match(r.uploads.GoFile, /^https:\/\/gofile\.io\/d\//);
  });

  await test('catches an oversized file whose size was unknown until downloaded', async () => {
    const r = await mirror(`${BASE}/file/stream.bin?size=${210 * MB}&chunked=1`);
    assert.match(r.uploads.Catbox, /Too big for this host \(210 MB, limit 200 MB\)/);
    assert.match(r.uploads.GoFile, /^https:\/\/gofile\.io\/d\//);
  });

  await test("skips Catbox for file types it doesn't accept", async () => {
    const r = await mirror(`${BASE}/file/setup.exe?size=${MB}`);
    assert.match(r.uploads.Catbox, /doesn't accept \.exe files/);
    assert.match(r.uploads.GoFile, /^https:\/\/gofile\.io\/d\//);
  });

  await test('shows the host error when an upload is refused', async () => {
    const r = await mirror(`${BASE}/file/reject-me.txt?size=1000`, { destinations: ['catbox'] });
    assert.match(r.uploads.Catbox, /Catbox refused the upload: File type not allowed/);
    assert.equal(r.status, 'No destination accepted the file');
  });

  // --- Download pages (page flow) ---------------------------------------------

  const card = () => popup.locator('#jobs > .job').first();

  /** Pastes a link in the popup and returns the tab EasyMirror opens for it. */
  async function pastePageLink(link, destinations = ['gofile', 'catbox']) {
    await choose(destinations);
    const tabPromise = context.waitForEvent('page');
    await popup.fill('#url', link);
    await popup.click('#mirror');
    const tab = await tabPromise;
    await tab.waitForLoadState('domcontentloaded');
    return tab;
  }

  /** Waits until the newest job reaches one of `statuses` in storage (with uploads settled), then lets the popup re-render. */
  async function settledCard(statuses = ['done', 'error', 'fallback-needed'], timeoutMs = 60_000) {
    // Poll from Node: page.waitForFunction doesn't await async predicates.
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const settled = await popup.evaluate(async (statuses) => {
        const all = await chrome.storage.local.get(null);
        const job = Object.entries(all)
          .filter(([k]) => k.startsWith('job:'))
          .map(([, v]) => v)
          .sort((a, b) => b.startedAt - a.startedAt)[0];
        return !!job && statuses.includes(job.status) && (job.status !== 'done' || Object.values(job.uploads).every((u) => u.done));
      }, statuses);
      if (settled) break;
      if (Date.now() > deadline) throw new Error(`newest job did not reach ${statuses.join('/')} in time`);
      await popup.waitForTimeout(250);
    }
    await popup.waitForTimeout(300); // let the popup re-render
  }

  async function finishedCard() {
    await settledCard(['done', 'error']);
    return {
      status: await card().locator('.job-status').innerText(),
      title: await card().locator('.job-title').innerText(),
      uploads: Object.fromEntries(
        await card().locator('.upload').evaluateAll((rows) =>
          rows.map((r) => [r.querySelector('.upload-name').textContent, r.querySelector('.upload-detail').textContent]),
        ),
      ),
    };
  }

  for (const variant of ['link-multi', 'js-download', 'form-post']) {
    await test(`download page (${variant}): opens it, catches the click, mirrors the file`, async () => {
      const name = `page-${variant}.bin`;
      const tab = await pastePageLink(`${BASE}/host/page?variant=${variant}&size=${3 * MB}&name=${name}`);
      await card().locator('.job-status').filter({ hasText: 'download page' }).waitFor({ timeout: 10_000 });
      // The user waits out the countdown and clicks Download.
      await tab.click('#dl', { timeout: 15_000 });
      const r = await finishedCard();
      assert.equal(r.status, '2 links ready');
      assert.equal(r.title, name);
      const s = await stats();
      assert.equal(s.received[`gofile:${name}`].sha256, s.served[name].sha256);
      assert.equal(s.received[`catbox:${name}`].sha256, s.served[name].sha256);
      // EasyMirror closes the tab it opened.
      if (!tab.isClosed()) await tab.waitForEvent('close', { timeout: 5000 });
    });
  }

  await test('"catch the next download" on a tab the user already has open', async () => {
    const name = 'watched.bin';
    const tab = await context.newPage();
    await tab.goto(`${BASE}/host/page?variant=js-download&size=${MB}&name=${name}`);
    // Same message the popup button and the page right-click menu send.
    await popup.evaluate(async (pageUrl) => {
      const [t] = await chrome.tabs.query({ url: pageUrl.split('?')[0] + '*' });
      await chrome.runtime.sendMessage({ type: 'watch-tab', tabId: t.id, pageUrl, destinations: ['gofile'] });
    }, tab.url());
    await tab.click('#dl', { timeout: 15_000 });
    const r = await finishedCard();
    assert.equal(r.status, 'Link ready');
    const s = await stats();
    assert.equal(s.received[`gofile:${name}`].sha256, s.served[name].sha256);
    assert.equal(tab.isClosed(), false, "the user's own tab stays open");
    await tab.close();
  });

  await test('single-use link: falls back to choosing the downloaded file', async () => {
    const name = 'once.bin';
    const tab = await pastePageLink(`${BASE}/host/page?variant=link-single&size=${2 * MB}&name=${name}`, ['gofile']);
    await tab.click('#dl', { timeout: 15_000 });
    await card().getByRole('button', { name: 'Choose the downloaded file' }).waitFor({ timeout: 30_000 });
    assert.match(await card().locator('.job-status').innerText(), /couldn't fetch the file again/);
    // The user picks the file their browser saved.
    const local = path.join(profile, 'picked-once.bin');
    writeFileSync(local, Buffer.alloc(2 * MB, 7));
    const pickerPromise = context.waitForEvent('page');
    await card().getByRole('button', { name: 'Choose the downloaded file' }).click();
    const picker = await pickerPromise;
    await picker.waitForSelector('#pick:not([hidden])');
    await picker.setInputFiles('#pick-file', local);
    await picker.locator('#pick-status').filter({ hasText: 'Uploading' }).waitFor({ timeout: 10_000 });
    const r = await finishedCard();
    assert.equal(r.status, 'Link ready');
    const s = await stats();
    assert.equal(s.received['gofile:picked-once.bin'].bytes, 2 * MB);
    await picker.close();
    if (!tab.isClosed()) await tab.close();
  });

  await test('page that builds the file itself (blob:) asks for the file straight away', async () => {
    const tab = await pastePageLink(`${BASE}/host/page?variant=blob&size=${MB}&name=built.bin`, ['gofile']);
    await tab.click('#dl', { timeout: 15_000 });
    await card().getByRole('button', { name: 'Choose the downloaded file' }).waitFor({ timeout: 30_000 });
    assert.match(await card().locator('.job-status').innerText(), /builds the file inside the page/);
    await tab.close();
  });

  await test('closing the page before downloading ends the job with a clear message', async () => {
    const tab = await pastePageLink(`${BASE}/page.html`, ['gofile']);
    await tab.close();
    await popup.locator('#jobs > .job .job-status').first().filter({ hasText: 'closed before a download started' }).waitFor({ timeout: 10_000 });
  });

  await test('Cancel stops waiting for a download page', async () => {
    const tab = await pastePageLink(`${BASE}/page.html`, ['gofile']);
    await card().getByRole('button', { name: 'Cancel' }).click();
    await popup.locator('#jobs > .job .job-status').first().filter({ hasText: 'Cancelled' }).waitFor({ timeout: 10_000 });
    await tab.close();
  });

  // --- Accounts (Pixeldrain, Google Drive, Yandex.Disk) -----------------------

  const setStorage = (items) => popup.evaluate((items) => chrome.storage.local.set(items), items);
  const HOUR = 3600_000;

  await test('hosts that need an account are off until connected', async () => {
    for (const id of ['pixeldrain', 'googledrive', 'yandex']) {
      assert.equal(await popup.locator(`#destinations input[value="${id}"]`).isDisabled(), true, id);
    }
    assert.match(await popup.locator('#destinations').innerText(), /Set up in Settings/);
  });

  await test('settings: a wrong Pixeldrain key is rejected, the right one connects', async () => {
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extId}/options.html`);
    const host = settings.locator('#host-pixeldrain');
    await host.locator('input[type=password]').fill('wrong-key');
    await host.getByRole('button', { name: 'Save' }).click();
    await host.locator('[role=status]').filter({ hasText: "doesn't work" }).waitFor({ timeout: 5000 });
    await host.locator('input[type=password]').fill('test-key');
    await host.getByRole('button', { name: 'Save' }).click();
    await settings.locator('#host-pixeldrain .state').filter({ hasText: 'Connected as tester' }).waitFor({ timeout: 5000 });
    // Without client IDs in this build, Google/Yandex explain the missing setup.
    assert.match(await settings.locator('#host-googledrive').innerText(), /one-time developer setup/);
    await settings.close();
  });

  await test('mirrors to Pixeldrain, Google Drive and Yandex.Disk with share links', async () => {
    // Stand-in for finishing Google/Yandex sign-in (the OAuth screens can't run offline).
    await setStorage({
      'accounts.google': { secret: 'test-token', expiresAt: Date.now() + HOUR, label: 'tester@example.com' },
      'accounts.yandex': { secret: 'test-token', label: 'Tester' },
    });
    await popup.waitForFunction(() => !document.querySelector('#destinations input[value="yandex"]')?.disabled, null, { timeout: 5000 });
    const r = await mirror(`${BASE}/file/holiday.mp4?size=${4 * MB}`, { destinations: ['pixeldrain', 'googledrive', 'yandex'] });
    assert.equal(r.status, '3 links ready');
    assert.match(r.uploads.Pixeldrain, /^https:\/\/pixeldrain\.com\/u\/\w+$/);
    assert.match(r.uploads['Google Drive'], /^https:\/\/drive\.google\.com\/file\/d\/file-\w+\/view$/);
    assert.match(r.uploads['Yandex.Disk'], /^https:\/\/yadi\.sk\/d\/\w+$/);
    const s = await stats();
    const src = s.served['holiday.mp4'].sha256;
    assert.equal(s.received['pixeldrain:holiday.mp4'].sha256, src);
    assert.equal(s.received['googledrive:holiday.mp4'].sha256, src);
    assert.equal(s.received['yandex:app:/holiday.mp4'].sha256, src);
    assert.deepEqual(s.hosts.driveFolders, ['folder-1'], 'one EasyMirror folder created');
    assert.deepEqual(s.hosts.driveShared.map((x) => x.type), ['anyone'], 'Drive file shared by link');
    assert.ok(s.hosts.yandexPublished.includes('app:/holiday.mp4'), 'Yandex file published');
  });

  await test('Yandex: a second file with the same name gets a numbered name', async () => {
    const r = await mirror(`${BASE}/file/holiday.mp4?size=${MB}`, { destinations: ['yandex'] });
    assert.equal(r.status, 'Link ready');
    assert.ok((await stats()).received['yandex:app:/holiday (1).mp4']);
  });

  await test('Drive: reuses its folder, and link sharing can be turned off', async () => {
    await setStorage({ 'hosts.googledrive.shareLink': false });
    const r = await mirror(`${BASE}/file/private.txt?size=1000`, { destinations: ['googledrive'] });
    assert.equal(r.status, 'Link ready');
    const s = await stats();
    assert.deepEqual(s.hosts.driveFolders, ['folder-1']);
    assert.equal(s.hosts.driveShared.length, 1, 'not shared this time');
    await setStorage({ 'hosts.googledrive.shareLink': true });
  });

  await test('an expired Google sign-in asks to reconnect; other hosts still get the file', async () => {
    await setStorage({ 'accounts.google': { secret: 'test-token', expiresAt: Date.now() - 1000, label: 'tester@example.com' } });
    const r = await mirror(`${BASE}/file/late.bin?size=${MB}`, { destinations: ['pixeldrain', 'googledrive'] });
    assert.equal(r.status, '1 of 2 links ready');
    assert.match(r.uploads['Google Drive'], /sign-in has expired\. Reconnect it in EasyMirror settings/);
    assert.match(r.uploads.Pixeldrain, /^https:\/\/pixeldrain\.com\/u\//);
  });

  await test('a revoked Pixeldrain key gives a clear message', async () => {
    await setStorage({ 'accounts.pixeldrain': { secret: 'revoked', label: 'tester' } });
    const r = await mirror(`${BASE}/file/again.bin?size=1000`, { destinations: ['pixeldrain'] });
    assert.match(r.uploads.Pixeldrain, /rejected your API key/);
  });

  await test('explains when the source link is broken', async () => {
    const r = await mirror(`${BASE}/missing`);
    assert.match(r.status, /Couldn't download the file: source answered HTTP 404/);
  });

  await test('rejects text that is not a link', async () => {
    await popup.fill('#url', 'not a link');
    await popup.click('#mirror');
    assert.match(await popup.locator('#form-error').innerText(), /starts with http/);
  });

  await test('remembers the chosen destinations', async () => {
    await popup.locator('#destinations input[value="gofile"]').uncheck();
    await popup.locator('#destinations input[value="catbox"]').check();
    await popup.reload();
    await popup.waitForSelector('#destinations input');
    assert.equal(await popup.locator('#destinations input[value="catbox"]').isChecked(), true);
    assert.equal(await popup.locator('#destinations input[value="gofile"]').isChecked(), false);
  });

  await popup.setViewportSize({ width: 380, height: 900 });
  await popup.screenshot({ path: 'tests/e2e/popup-jobs.png', fullPage: true });

  await test('"Clear finished" empties the list', async () => {
    await popup.click('#clear');
    await popup.waitForFunction(() => document.querySelectorAll('#jobs > .job').length === 0, null, { timeout: 5000 });
  });
} finally {
  await context.close();
  server.kill();
  rmSync(profile, { recursive: true, force: true });
}

console.log(`\nEnd-to-end\n${results.join('\n')}\n`);
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
