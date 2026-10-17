# EasyMirror

Browser extension that mirrors a file from a link to your own storage hosts: paste a link (or right-click one), pick destinations, get share links back.

Status: direct file links **and download pages** (e.g. `gofile.io/d/…`) to 11 hosts: GoFile, Catbox, Buzzheavier, VikingFile, 1Fichier and FileDitch with no account; Pixeldrain, Clicknupload, Send.now, Daily Uploads and HexUpload with the user's API key (Settings page). Krakenfiles is built but switched off until a real upload works (`KRAKENFILES_ENABLED` in [src/features.ts](src/features.ts)). See [docs/plan.md](docs/plan.md) for what's next.

Google Drive and Yandex.Disk support is built and tested but **switched off** in release builds (`OAUTH_HOSTS_ENABLED` in [src/features.ts](src/features.ts)). They need a one-time app registration with Google and Yandex first: [docs/account-setup.md](docs/account-setup.md). Test builds always include them.

## Try it

```bash
npm install
npm run build
```

Then load `.output/chrome-mv3` as an unpacked extension:
- **Chrome:** `chrome://extensions` → turn on Developer mode → Load unpacked.
- **Edge:** `edge://extensions` → turn on Developer mode → Load unpacked.

For Firefox (140 or newer), run `npx wxt build -b firefox`, open `about:debugging#/runtime/this-firefox` → Load Temporary Add-on, and pick `.output/firefox-mv2/manifest.json`.

Three ways to mirror:
- **Paste a link** in the popup. A direct file link mirrors straight away; a download page opens in a tab, you click its Download button, and EasyMirror takes over that download.
- **Right-click a link** → "Mirror with EasyMirror".
- **On a host's page:** popup → "Catch the next download on this page", or right-click the page → "Mirror the next download on this page". Then click the site's Download button.

If a site's link only works once, or the page builds the file itself, your browser keeps its download and EasyMirror asks you to choose that file.

## Develop

| Command | What it does |
|---|---|
| `npm run dev` | Dev build with hot reload, opens a browser with the extension loaded |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Builds the test variant and drives the real popup against mock hosts (Playwright). `CHANNEL=msedge node tests/e2e/e2e.mjs` runs it in Edge |
| `npm run real-upload -- gofile,catbox` | Uploads one tiny text file to the named **real** hosts and prints the links. API keys come from `.env.local` (see `.env.example`) |
| `npm run zip` | Store zips in `.output/`: Chrome/Edge, Firefox, and the source zip Firefox reviewers ask for |
| `npm run build:spike && npm run spike:run` | M0 checks: large files, service-worker stop, page flow |
| `npm run icons` | Redraws the toolbar icons |

The `spike` build mode points every host at the local mock server in `spikes/server.mjs`, so tests never upload to the real sites.

## Layout

```
src/
  entrypoints/
    background.ts      wires browser events (menus, messages, downloads) to src/background
    offscreen/         Chrome's home for the transfer engine
    popup/             the popup UI
    options/           Settings page: connect accounts and keys
    spike/             test control page (spike builds only)
  background/          jobs.ts (start, finish, cancel, try again, recover after a restart), flows.ts (page flow)
  accounts/            stored credentials and OAuth sign-in (Google, Yandex)
  engine/              the transfer engine (download to browser disk with resume, upload with progress) and shared types
  messages.ts          typed messages between the popup, background and engine
  hosts/               one file per host: limits, request format, response → link
  jobs/store.ts        job state and settings in browser storage
docs/                  research, plan, M0 results
spikes/, tests/e2e/    local mock server and automated browser tests
```
