// Store images: four 1280x800 screenshots and a 440x280 promo tile.
//   npm run build && node scripts/store-screenshots.mjs
// Captures the real popup and Settings page of the release build (filled with
// sample history), then places them on simple branded backgrounds.
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXT = path.resolve('.output/chrome-mv3');
const OUT = path.resolve('store-assets');
const MB = 1024 * 1024;
const GB = 1024 * MB;

// --- Sample data (demo links, not real files) --------------------------------

const now = Date.now();
const job = (id, minutesAgo, fields) => ({
  id,
  downloaded: 0,
  uploads: {},
  startedAt: now - minutesAgo * 60_000,
  updatedAt: now - minutesAgo * 60_000,
  notified: true,
  ...fields,
});
const done = (link) => ({ sent: 1, done: true, link });

const JOBS = {
  finished: [
    job('demo-1', 2, {
      status: 'done',
      sourceUrl: 'https://example.com/share/project-files.zip',
      name: 'project-files.zip',
      size: 48 * MB,
      uploads: {
        gofile: done('https://gofile.io/d/demoA1'),
        catbox: done('https://files.catbox.moe/demo01.zip'),
        pixeldrain: done('https://pixeldrain.com/u/demoXy12'),
      },
    }),
    job('demo-2', 30, {
      status: 'done',
      sourceUrl: 'https://example.com/videos/holiday-video.mp4',
      name: 'holiday-video.mp4',
      size: 1.4 * GB,
      uploads: {
        gofile: done('https://gofile.io/d/demoB2'),
        catbox: { sent: 0, done: true, skipped: 'Catbox takes files up to 200 MB (this one is 1.4 GB)' },
        pixeldrain: done('https://pixeldrain.com/u/demoZq34'),
      },
    }),
  ],
  waiting: job('demo-3', 0, {
    status: 'waiting-for-user',
    pageMode: 'watching',
    notified: false,
    sourceUrl: 'https://files.example.net/f/8kq2',
    uploads: { gofile: { sent: 0, done: false }, catbox: { sent: 0, done: false }, pixeldrain: { sent: 0, done: false } },
  }),
  uploading: job('demo-4', 0, {
    status: 'uploading',
    notified: false,
    sourceUrl: 'https://example.com/backup/photo-library-2026.zip',
    name: 'photo-library-2026.zip',
    size: 2.3 * GB,
    downloaded: 2.3 * GB,
    total: 2.3 * GB,
    uploads: {
      gofile: { sent: 0.64 * 2.3 * GB, done: false },
      catbox: { sent: 0, done: true, skipped: 'Catbox takes files up to 200 MB (this one is 2.3 GB)' },
      pixeldrain: { sent: 0.41 * 2.3 * GB, done: false },
    },
  }),
};

const BASE_STORAGE = {
  settings: { destinations: ['gofile', 'catbox', 'pixeldrain'] },
  'accounts.pixeldrain': { secret: 'demo', label: 'yourname' },
  'hosts.gofile.token': 'demo',
  'hosts.gofile.tokenKind': 'guest',
};

// --- Capture the real extension pages ------------------------------------------

async function captureExtension() {
  const profile = mkdtempSync(path.join(tmpdir(), 'em-shots-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    deviceScaleFactor: 2,
    viewport: { width: 380, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const shots = {};
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    const id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/popup.html`);

    const show = async (jobs, { url = '' } = {}) => {
      await page.evaluate(async (items) => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set(items);
      }, { ...BASE_STORAGE, ...Object.fromEntries(jobs.map((j) => [`job:${j.id}`, j])) });
      await page.reload();
      await page.waitForSelector('#destinations input');
      await page.waitForTimeout(400);
      // Once the user has granted access the hint is gone; show that state.
      await page.evaluate((url) => {
        document.getElementById('permission-hint').hidden = true;
        const input = document.getElementById('url');
        input.value = url;
        input.blur();
      }, url);
    };

    // Whole popup, cut right below its content (one job each, so nothing is clipped).
    const popupShot = async () => {
      const height = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().bottom));
      return page.screenshot({ clip: { x: 0, y: 0, width: 380, height } });
    };

    await show([JOBS.finished[0]], { url: 'https://example.com/share/project-files.zip' });
    shots.popupFinished = await popupShot();

    await show([JOBS.waiting]);
    shots.popupWaiting = await popupShot();

    await show([JOBS.uploading]);
    shots.popupUploading = await popupShot();

    await page.setViewportSize({ width: 620, height: 560 });
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.waitForSelector('#host-pixeldrain .state');
    await page.waitForTimeout(300);
    shots.settings = await page.screenshot({ clip: { x: 0, y: 0, width: 620, height: 560 } });
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
  return shots;
}

// --- Compose store images --------------------------------------------------------

const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const icon = dataUrl(readFileSync('public/icon/128.png'));

const STYLE = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #10203f; }
  .frame { width: 1280px; height: 800px; display: flex; align-items: center; gap: 64px; padding: 0 88px;
    background: radial-gradient(1200px 700px at 0% 0%, #f4f7ff 0%, #e3ebff 55%, #d4e0ff 100%); overflow: hidden; }
  .copy { flex: 1; min-width: 0; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 650; color: #2563eb; margin-bottom: 28px; }
  .brand img { width: 40px; height: 40px; }
  h1 { font-size: 52px; line-height: 1.08; font-weight: 750; letter-spacing: -0.02em; }
  p.sub { margin-top: 22px; font-size: 22px; line-height: 1.45; color: #3b4a66; max-width: 520px; }
  .shot { border-radius: 14px; box-shadow: 0 24px 60px rgba(20, 40, 90, 0.22), 0 2px 6px rgba(20, 40, 90, 0.12); background: #fff; }
`;

function slide({ title, sub, visual }) {
  return `<style>${STYLE}</style><div class="frame">
    <div class="copy">
      <div class="brand"><img src="${icon}" alt="">EasyMirror</div>
      <h1>${title}</h1>
      <p class="sub">${sub}</p>
    </div>
    ${visual}
  </div>`;
}

/** PNG width/height from its header. */
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

/** Popup capture shown at `scale` of its CSS size (captures are 2x), never taller than `maxHeight`. */
function popupImg(buf, { scale = 1.15, maxHeight = 720 } = {}) {
  const { width, height } = pngSize(buf);
  const s = Math.min(scale, (maxHeight * 2) / height);
  return `<img class="shot" src="${dataUrl(buf)}" style="width:${Math.round((width / 2) * s)}px;flex:none">`;
}

/** A neutral, made-up file host page with the popup beside it, its Download button in view. */
function hostScene(popup) {
  const { width, height } = pngSize(popup);
  const popupWidth = 320;
  const popupHeight = Math.round((height / width) * popupWidth);
  return `<div style="position:relative;width:740px;height:${Math.max(popupHeight, 600)}px;flex:none">
    <div class="shot" style="position:absolute;left:0;top:70px;width:480px;height:460px;overflow:hidden">
      <div style="height:42px;background:#eef1f6;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid #dde2ea">
        <span style="width:11px;height:11px;border-radius:50%;background:#f26b5e"></span>
        <span style="width:11px;height:11px;border-radius:50%;background:#f5bd4f"></span>
        <span style="width:11px;height:11px;border-radius:50%;background:#5cc85a"></span>
        <span style="margin-left:14px;flex:1;height:26px;border-radius:13px;background:#fff;color:#6b778c;font-size:13px;line-height:26px;padding-left:14px">files.example.net/f/8kq2</span>
      </div>
      <div style="padding:52px 32px;text-align:center">
        <div style="font-size:15px;color:#6b778c;letter-spacing:.06em;text-transform:uppercase">Example file host</div>
        <div style="margin-top:18px;font-size:26px;font-weight:650">trip-photos.zip</div>
        <div style="margin-top:6px;color:#6b778c;font-size:16px">312 MB · uploaded 3 days ago</div>
        <div style="margin:34px auto 0;width:240px;padding:14px 0;border-radius:10px;background:#16a34a;color:#fff;font-size:19px;font-weight:650">Download</div>
        <div style="margin-top:16px;color:#94a0b4;font-size:13px">Your download is ready</div>
      </div>
    </div>
    <img class="shot" src="${dataUrl(popup)}" style="position:absolute;right:0;top:0;width:${popupWidth}px">
  </div>`;
}

function promoTile() {
  return `<style>${STYLE}
    .tile { width: 440px; height: 280px; display: flex; flex-direction: column; justify-content: center; padding: 0 40px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 60%, #1e3a8a 100%); color: #fff; }
    .tile .row { display: flex; align-items: center; gap: 16px; }
    .tile img { width: 64px; height: 64px; border-radius: 16px; border: 3px solid rgba(255,255,255,.9); box-shadow: 0 6px 18px rgba(0,0,0,.25); }
    .tile .name { font-size: 38px; font-weight: 750; letter-spacing: -0.01em; }
    .tile .tag { margin-top: 18px; font-size: 19px; line-height: 1.35; color: #dbe6ff; }
  </style><div class="tile">
    <div class="row"><img src="${icon}" alt=""><div class="name">EasyMirror</div></div>
    <div class="tag">Mirror any link to GoFile, Catbox and Pixeldrain in one click</div>
  </div>`;
}

async function compose(shots) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const slides = [
    {
      file: '1-mirror-a-link.png',
      title: 'Mirror any file link in one click',
      sub: 'Paste a link or right-click it. EasyMirror downloads it once and uploads it to every host you pick.',
      visual: popupImg(shots.popupFinished),
    },
    {
      file: '2-download-pages.png',
      title: 'Works with download pages',
      sub: 'Open the page, press "Catch the next download", and click its Download button. EasyMirror takes it from there.',
      visual: hostScene(shots.popupWaiting),
    },
    {
      file: '3-big-files.png',
      title: 'Big files, every host at once',
      sub: 'Multi-GB files upload to all your hosts in parallel, with progress for each. Limits are checked before anything is sent.',
      visual: popupImg(shots.popupUploading),
    },
    {
      file: '4-your-accounts.png',
      title: 'Your accounts stay yours',
      sub: 'No server, no tracking. Keys are stored only in your browser and sent only to the host they belong to.',
      visual: `<img class="shot" src="${dataUrl(shots.settings)}" style="width:560px">`,
    },
  ];
  for (const s of slides) {
    await page.setContent(slide(s));
    await page.screenshot({ path: path.join(OUT, s.file) });
  }
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(promoTile());
  await page.screenshot({ path: path.join(OUT, 'promo-tile-440x280.png') });
  await browser.close();
  return slides.map((s) => s.file).concat('promo-tile-440x280.png');
}

mkdirSync(OUT, { recursive: true });
const shots = await captureExtension();
const files = await compose(shots);
writeFileSync(path.join(OUT, 'README.md'), [
  '# Store images',
  '',
  'Generated by `scripts/store-screenshots.mjs` from the release build (`npm run build` first).',
  'Links and file names in them are sample data.',
  '',
  ...files.map((f) => `- ${f}`),
  '',
].join('\n'));
console.log(`wrote ${files.length} images to ${OUT}`);
