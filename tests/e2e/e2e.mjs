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
  // CHANNEL=msedge runs the same tests in Microsoft Edge.
  channel: process.env.CHANNEL ?? 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

const stats = async () => (await fetch(`${BASE}/stats`)).json();
const results = [];
let failed = 0;

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    results.push(`  ✗ ${name}\n      ${String(e.message ?? e).split('\n').join('\n      ')}`);
  }
  // Live progress; the full summary is printed at the end.
  console.log(`${results.at(-1).split('\n')[0]} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
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

  /** Id of the most recently started job (the popup shows at most 20 cards, so count can't tell). */
  const newestJobId = () =>
    popup.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      const jobs = Object.entries(all).filter(([k]) => k.startsWith('job:')).map(([, v]) => v);
      return jobs.sort((a, b) => b.startedAt - a.startedAt)[0]?.id ?? null;
    });

  async function mirror(link, { destinations = ['gofile', 'catbox'] } = {}) {
    await choose(destinations);
    const before = await newestJobId();
    await popup.fill('#url', link);
    await popup.click('#mirror');
    const deadline = Date.now() + 10_000;
    while ((await newestJobId()) === before) {
      if (Date.now() > deadline) throw new Error('the mirror did not start');
      await popup.waitForTimeout(100);
    }
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
    assert.match(r.uploads.Catbox, /Catbox takes files up to 200 MB \(this one is 210 MB\)/);
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

  // --- More no-account hosts (Buzzheavier, VikingFile, Krakenfiles) -------------

  await test('mirrors to Buzzheavier, VikingFile and Krakenfiles with share links', async () => {
    const r = await mirror(`${BASE}/file/report.pdf?size=${3 * MB}`, { destinations: ['buzzheavier', 'vikingfile', 'krakenfiles'] });
    assert.equal(r.status, '3 links ready');
    assert.match(r.uploads.Buzzheavier, /^https:\/\/buzzheavier\.com\/\w+$/);
    assert.match(r.uploads.VikingFile, /^https:\/\/vikingfile\.com\/f\/\w+$/);
    assert.match(r.uploads.Krakenfiles, /^https:\/\/krakenfiles\.com\/view\/\w+\/file\.html$/);
    const s = await stats();
    const src = s.served['report.pdf'].sha256;
    for (const host of ['buzzheavier', 'vikingfile', 'krakenfiles']) assert.equal(s.received[`${host}:report.pdf`].sha256, src, host);
  });

  await test('a refused upload shows that host’s own reason', async () => {
    const r = await mirror(`${BASE}/file/reject-me.bin?size=1000`, { destinations: ['buzzheavier', 'krakenfiles', 'vikingfile'] });
    assert.equal(r.status, '1 of 3 links ready');
    assert.match(r.uploads.Buzzheavier, /Buzzheavier refused the upload \(file rejected\)/);
    assert.match(r.uploads.Krakenfiles, /Krakenfiles refused the upload \(File type not allowed\)/);
  });

  await test('mirrors to 1Fichier, and to FileDitch in pieces, with share links', async () => {
    const r = await mirror(`${BASE}/file/album.zip?size=${3.5 * MB}`, { destinations: ['onefichier', 'fileditch'] });
    assert.equal(r.status, '2 links ready');
    assert.match(r.uploads['1Fichier'], /^https:\/\/1fichier\.com\/\?\w+$/);
    assert.match(r.uploads.FileDitch, /^https:\/\/fileditch\.com\/f\/\w+\/album\.zip$/);
    const s = await stats();
    const src = s.served['album.zip'].sha256;
    assert.equal(s.received['onefichier:album.zip'].sha256, src);
    assert.equal(s.received['fileditch:album.zip'].sha256, src, 'the 4 pieces put back together match');
  });

  await test('FileDitch: a failed piece is retried and a missing piece is sent again', async () => {
    const r = await mirror(`${BASE}/file/flaky-gap.bin?size=${3.5 * MB}`, { destinations: ['fileditch'] });
    assert.equal(r.status, 'Link ready');
    const s = await stats();
    assert.equal(s.received['fileditch:flaky-gap.bin'].sha256, s.served['flaky-gap.bin'].sha256);
    assert.deepEqual(
      s.hosts.fileditchFinish.filter((f) => f.name === 'flaky-gap.bin').map((f) => f.missing),
      [[2], []],
    );
  });

  await test('FileDitch opens its upload only after the download, so an unknown size is fine', async () => {
    const r = await mirror(`${BASE}/file/no-length.bin?size=${2.5 * MB}&chunked=1`, { destinations: ['fileditch'] });
    assert.equal(r.status, 'Link ready');
    const s = await stats();
    const init = s.hosts.fileditchInit.find((x) => x.name === 'no-length.bin');
    assert.equal(init.size, 2.5 * MB, 'started with the real size');
    assert.ok(init.at >= s.served['no-length.bin'].finishedAt, 'started after the download finished');
    assert.equal(s.received['fileditch:no-length.bin'].sha256, s.served['no-length.bin'].sha256);
  });

  await test("FileDitch is skipped for file types it doesn't accept", async () => {
    const r = await mirror(`${BASE}/file/tool.apk?size=1000`, { destinations: ['gofile', 'fileditch'] });
    assert.match(r.uploads.FileDitch, /FileDitch doesn't accept \.apk files/);
    assert.match(r.uploads.GoFile, /^https:\/\/gofile\.io\/d\//);
  });

  // --- Accounts (Pixeldrain, XFileSharing hosts, Google Drive, Yandex.Disk) ------

  const setStorage = (items) => popup.evaluate((items) => chrome.storage.local.set(items), items);
  const HOUR = 3600_000;

  await test('hosts that need an account are only named until connected', async () => {
    for (const id of ['pixeldrain', 'clicknupload', 'sendnow', 'dailyuploads', 'hexupload', 'googledrive', 'yandex']) {
      assert.equal(await popup.locator(`#destinations input[value="${id}"]`).count(), 0, id);
    }
    const more = await popup.locator('#destinations .dest-more').innerText();
    assert.match(more, /With your own account: Pixeldrain, Clicknupload, Send\.now, Daily Uploads, HexUpload/);
    assert.match(more, /Set up in Settings/);
  });

  await test('settings: an XFileSharing key is checked, then the host can be picked', async () => {
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extId}/options.html`);
    assert.match(await settings.locator('#host-nosetup').innerText(), /Buzzheavier, VikingFile, 1Fichier, FileDitch, Krakenfiles/);
    const host = settings.locator('#host-clicknupload');
    await host.locator('input[type=password]').fill('wrong-key');
    await host.getByRole('button', { name: 'Save' }).click();
    await host.locator('[role=status]').filter({ hasText: "doesn't work" }).waitFor({ timeout: 5000 });
    await host.locator('input[type=password]').fill('test-key');
    await host.getByRole('button', { name: 'Save' }).click();
    await settings.locator('#host-clicknupload .state').filter({ hasText: 'Connected as tester' }).waitFor({ timeout: 5000 });
    await settings.close();
    await popup.locator('#destinations input[value="clicknupload"]').waitFor({ timeout: 5000 });
    assert.doesNotMatch(await popup.locator('#destinations .dest-more').innerText(), /Clicknupload/);
  });

  await test('mirrors to Clicknupload and Send.now with share links', async () => {
    await setStorage({ 'accounts.sendnow': { secret: 'test-key', label: 'tester' } });
    await popup.locator('#destinations input[value="sendnow"]').waitFor({ timeout: 5000 });
    const r = await mirror(`${BASE}/file/backup.7z?size=${2 * MB}`, { destinations: ['clicknupload', 'sendnow'] });
    assert.equal(r.status, '2 links ready');
    assert.match(r.uploads.Clicknupload, /^https:\/\/clicknupload\.click\/\w+$/);
    assert.match(r.uploads['Send.now'], /^https:\/\/send\.now\/\w+$/);
    const s = await stats();
    const src = s.served['backup.7z'].sha256;
    assert.equal(s.received['clicknupload.click:backup.7z'].sha256, src);
    assert.equal(s.received['send.now:backup.7z'].sha256, src);
    assert.deepEqual(
      s.hosts.xfsUploads.map((u) => [u.site, u.utype]).sort(),
      [['clicknupload.click', 'reg'], ['send.now', 'reg']],
    );
    for (const u of s.hosts.xfsUploads) assert.equal(u.query, '?upload_type=file&utype=reg', u.site);
  });

  await test('a revoked XFileSharing key gives a clear message', async () => {
    await setStorage({ 'accounts.sendnow': { secret: 'revoked', label: 'tester' } });
    const r = await mirror(`${BASE}/file/again.7z?size=1000`, { destinations: ['sendnow'] });
    assert.match(r.uploads['Send.now'], /Send\.now rejected your API key/);
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

  await test('a host that takes the file but never answers is given up on; other hosts still finish', async () => {
    const r = await mirror(`${BASE}/file/silent.bin?size=${MB}`);
    assert.equal(r.status, '1 of 2 links ready');
    assert.match(r.uploads.Catbox, /got the whole file but didn't answer for 5 seconds/);
    assert.match(r.uploads.GoFile, /^https:\/\/gofile\.io\/d\//);
  });

  await test('a download that goes quiet ends with a clear message instead of hanging', async () => {
    const r = await mirror(`${BASE}/file/quiet.bin?size=${20 * MB}&stall=${2 * MB}`);
    assert.match(r.status, /Couldn't download the file: the download stopped moving for 3 seconds/);
  });

  await test('explains when the source link is broken', async () => {
    const r = await mirror(`${BASE}/missing`);
    assert.match(r.status, /Couldn't download the file: source answered HTTP 404/);
  });

  await test('a failed mirror can be reported, with details shown first and names left out', async () => {
    // The newest job is the broken-link mirror from the previous test.
    const reportPromise = context.waitForEvent('page');
    await card().getByRole('button', { name: 'Report this problem' }).click();
    const report = await reportPromise;
    await report.waitForLoadState('domcontentloaded');
    assert.match(report.url(), /\/report\.html\?job=/);
    const pre = report.locator('#details');
    await pre.filter({ hasText: 'Reported mirror:' }).waitFor({ timeout: 5000 });
    const text = await pre.innerText();
    assert.match(text, /^EasyMirror \d+\.\d+\.\d+/);
    assert.match(text, /error: Couldn't download the file: source answered HTTP 404/);
    assert.doesNotMatch(text, /127\.0\.0\.1\/missing/, 'source link left out by default');
    await report.locator('#include-names').check();
    await pre.filter({ hasText: 'source: http://127.0.0.1:8787/missing' }).waitFor({ timeout: 5000 });
    // The form opens with the details filled in.
    const formPromise = context.waitForEvent('page');
    await report.getByRole('button', { name: 'Open the feedback form' }).click();
    const form = await formPromise;
    const details = new URL(form.url()).searchParams.get('details');
    assert.match(form.url(), /^http:\/\/127\.0\.0\.1:8787\/mock\/form\?details=/);
    assert.match(details, /Reported mirror:/);
    assert.match(details, /source: http:\/\/127\.0\.0\.1:8787\/missing/);
    await form.close();
    // Unticking "Include technical details" sends an empty field.
    await report.locator('#include-details').uncheck();
    const emptyPromise = context.waitForEvent('page');
    await report.getByRole('button', { name: 'Open the feedback form' }).click();
    const empty = await emptyPromise;
    assert.equal(new URL(empty.url()).searchParams.get('details'), '');
    await empty.close();
    await report.close();
  });

  await test('popup footer links to the report page and the donation page', async () => {
    assert.equal(await popup.locator('#donate-link').getAttribute('href'), 'http://127.0.0.1:8787/mock/donate');
    const pagePromise = context.waitForEvent('page');
    await popup.click('#report-link');
    const report = await pagePromise;
    await report.waitForLoadState('domcontentloaded');
    assert.match(report.url(), /\/report\.html$/);
    await report.close();
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
