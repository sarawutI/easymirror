# EasyMirror

Browser extension that mirrors a file from a link to your own storage hosts: paste a link (or right-click one), pick destinations, get share links back.

Status: direct file links **and download pages** (e.g. `gofile.io/d/…`) to 9 hosts: GoFile, Catbox, Buzzheavier and VikingFile with no account; Pixeldrain, Clicknupload, Send.now, Daily Uploads and HexUpload with the user's API key (Settings page). Krakenfiles is built but switched off until a real upload works (`KRAKENFILES_ENABLED` in [src/features.ts](src/features.ts)). See [docs/plan.md](docs/plan.md) for what's next.

Google Drive and Yandex.Disk support is built and tested but **switched off** in release builds (`OAUTH_HOSTS_ENABLED` in [src/features.ts](src/features.ts)). They need a one-time app registration with Google and Yandex first: [docs/account-setup.md](docs/account-setup.md). Test builds always include them.

## Try it

```bash
npm install
npm run build
```

Then load `.output/chrome-mv3` as an unpacked extension:
- **Chrome:** `chrome://extensions` → turn on Developer mode → Load unpacked.
- **Edge:** `edge://extensions` → turn on Developer mode → Load unpacked.

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
| `npm run test:e2e` | Builds the test variant and drives the real popup against mock hosts (Playwright) |
| `npm run build:spike && npm run spike:run` | M0 checks: large files, service-worker stop, page flow |
| `npm run icons` | Redraws the toolbar icons |

The `spike` build mode points every host at the local mock server in `spikes/server.mjs`, so tests never upload to the real sites.

## Layout

```
src/
  entrypoints/
    background.ts      job manager, right-click menu, notifications, page flow
    offscreen/         transfer engine (download to browser disk, upload with progress)
    popup/             the popup UI
    options/           Settings page: connect accounts and keys
    spike/             test control page (spike builds only)
  accounts/            stored credentials and OAuth sign-in (Google, Yandex)
  engine/              transfer code and shared types
  hosts/               one file per host: limits, request format, response → link
  jobs/store.ts        job state and settings in browser storage
docs/                  research, plan, M0 results
spikes/, tests/e2e/    local mock server and automated browser tests
```
