# EasyMirror — extension plan (v1)

Based on [host-research.md](host-research.md). Decisions so far: browser extension, users own their accounts, no server of ours, no captcha bypass.

## What the user sees

1. **Right-click a link → "Mirror with EasyMirror"**, or paste a URL into the popup.
2. Pick destinations (checkboxes, remembers last choice): GoFile, Catbox, Pixeldrain, Google Drive, Yandex.Disk.
3. Progress bar per destination. When done, the new links are shown with a **Copy all** button, and a notification appears.
4. **Settings page:** connect accounts (Google / Yandex sign-in buttons, Pixeldrain API key field, optional GoFile token and Catbox userhash).
5. **History:** past mirrors and their links.

If the source is a page with a timer or captcha, the extension opens it in a tab and says "Click the download button on this page". It catches the download and carries on.

## Tech choices

- **TypeScript** + **[WXT](https://wxt.dev)** (extension framework: one codebase builds Chrome and Firefox, hot reload, Manifest V3).
- **Chrome first**, Firefox in a later milestone.
- UI: plain WXT with a small framework (Preact or Svelte — small bundles). Picked at build time.
- Tests: Vitest with mocked `fetch` for each host adapter; manual end-to-end runs with real test accounts.

## Architecture

```
 popup / context menu / settings page
              │  messages
              ▼
   background service worker  ── job manager (queue, state in storage)
              │
              ▼
   transfer engine (offscreen document in Chrome, background page in Firefox)
     ├─ source resolvers     url → direct download, or "needs page flow"
     ├─ temp storage (OPFS)  file saved to the browser's private disk area
     └─ destination adapters upload / remote upload, report progress
```

### Why an offscreen document
Chrome's MV3 service worker can be stopped while idle, which is risky during a long transfer. An offscreen document is a hidden page that can run a multi-GB transfer reliably. Firefox keeps a background page, so the same engine runs there directly.

### Transfer strategy (per job)
1. **Remote upload** when the source is a public direct link and the destination supports it (Catbox, Yandex.Disk). The host fetches the file itself, so nothing goes through the user's connection.
2. Otherwise, **download once to OPFS, then upload to each destination** from disk. This keeps memory low for big files, and one download feeds several destinations.
3. Later optimization (not v1): stream straight from source to destination without a temp file.

Temp files are deleted when the job finishes or fails.

### Interfaces

```ts
interface SourceResolver {
  id: string;
  matches(url: URL): boolean;
  resolve(url: URL): Promise<
    | { kind: 'direct'; url: string; name?: string; size?: number; headers?: Record<string, string> }
    | { kind: 'page' }              // fall back to page flow
  >;
}

interface DestinationAdapter {
  id: string;
  maxFileSize?: number;             // e.g. Catbox 200 MB
  needsAuth: 'none' | 'optional' | 'apiKey' | 'oauth';
  upload(file: File, ctx: UploadContext): Promise<{ url: string }>;
  remoteUpload?(sourceUrl: string, ctx: UploadContext): Promise<{ url: string }>;
}
```

Each host is one file under `src/hosts/`. Adding a host later doesn't touch the rest.

## Host details (v1)

| Host | As destination | As source | Auth setup |
|---|---|---|---|
| GoFile | Multipart POST to `upload.gofile.io`; reuse the guest token from the first upload, or the user's token | Page flow (API content access is premium-only) | None, or paste account token |
| Catbox | POST `user/api.php` (`fileupload`); `urlupload` for remote. Check before uploading: max 200 MB, no `.exe/.scr/.cpl/.doc*/.jar` | Direct links (`files.catbox.moe`) | None, or paste userhash |
| Pixeldrain | `PUT /api/file/{name}` with Basic auth (key as password) | `GET /api/file/{id}`; on captcha errors switch to page flow | Paste API key |
| Google Drive | Resumable upload API (chunked, survives hiccups) | Drive API for files the user can access; public links via API/confirm page | Google sign-in, scope `drive.file` (only files the app creates/opens) |
| Yandex.Disk | Get upload URL, then PUT; upload-by-URL for remote | Public download API, no auth | Yandex sign-in |

Plus a **generic direct-URL source**: any link that returns a file directly.

### Page flow (sources with timers/captchas) — proven in M0
1. Open the source page in a new tab.
2. Record that tab's requests with non-blocking `webRequest` (includes form POST bodies).
3. On `downloads.onCreated`, match the download to the tab's requests and **pause** it.
4. Refetch the same request (method, body, the user's cookies) in the engine.
5. Refetch OK → cancel the browser's copy. Refetch failed (single-use link) → resume the browser's download and ask the user to pick the finished file.

### Accounts and data
- OAuth via `identity.launchWebAuthFlow` (works in Chrome and Firefox).
- Tokens and keys stay in `storage.local` on the user's machine. Nothing is sent anywhere except to the host it belongs to.
- No analytics in v1.

### Permissions
- Required: `storage`, `contextMenus`, `downloads`, `identity`, `offscreen`, `notifications`, and host permissions for the 5 hosts.
- Optional, asked at first use: access to all sites, needed to download from arbitrary source links. Asking at runtime keeps the install prompt less scary.

## Milestones

**M0 — Spikes (prove the risky parts first)** ✅ done 2026-10-17, see [m0-results.md](m0-results.md)
- Transfer 1 GB and 5 GB files through OPFS in an offscreen document without crashing.
- Page flow: catch and refetch a download on 2–3 real timer/captcha hosts.
- Confirm GoFile's current upload API and Catbox's size limit.

**M1 — Skeleton, no-account hosts** ✅ done 2026-10-17 (tested against mock GoFile/Catbox; not yet against the real sites)
- WXT project, popup, context menu, job manager, generic direct-URL source.
- GoFile and Catbox destinations. End-to-end: paste link → links come back.

**M2 — Accounts** — built 2026-10-17 on branch `m2-accounts`, tested against mock hosts. **Decision (2026-10-17): the first public release ships GoFile, Catbox and Pixeldrain only.** Google Drive and Yandex.Disk are finished and tested but switched off (`OAUTH_HOSTS_ENABLED` in `src/features.ts`). Turn them on in a later update after the one-time app registration in [account-setup.md](account-setup.md) and Google's review.
- Settings page. Pixeldrain (API key), Google Drive and Yandex.Disk (OAuth).

**M3 — Sources** — page flow pulled forward and done 2026-10-17: paste a download-page link, "catch the next download on this page" (popup button + page right-click), JS-triggered and form downloads, choose-the-file fallback for single-use and blob: downloads, cancel, closed-tab handling. Still to do: host-specific resolvers (skip the page when a host has a public download API) and checks on real hosts.
- Resolvers for Drive, Yandex, Pixeldrain, Catbox, GoFile, plus the page flow.

**More hosts** — built 2026-10-17 on branch `more-hosts`, tested against mock hosts. Added the easy ones from the list (see the 2026-10-17 update in [host-research.md](host-research.md)): Buzzheavier, VikingFile and Krakenfiles with no account, and Clicknupload, Send.now, Daily Uploads and HexUpload through one shared XFileSharing adapter with the user's API key. Real test upload on 2026-10-17: Buzzheavier and VikingFile work. Krakenfiles is switched off (`KRAKENFILES_ENABLED` in `src/features.ts`) because all its upload servers refused connections; turn it on after a real upload works. The four XFileSharing hosts still need a test with a real account. Later: Bunkr (needs chunked uploads), Mixdrop (video only).

**M4 — Polish**
- Remote upload shortcut, history, retry button, clear error messages ("Catbox: file too big, 200 MB max"), notifications.

**M5 — Release**
- Firefox build, privacy policy, Chrome Web Store and Firefox Add-ons submission.

## Risks

| Risk | Impact | Plan |
|---|---|---|
| Large files fail in the browser | High | M0 spike. If it fails, add the optional desktop helper earlier |
| Page-flow links are single-use or IP/cookie-bound | Medium | Refetch with cookies; fallback to "download, then pick file" |
| GoFile API changes again (it's in beta) | Medium | Isolated adapter, quick to fix |
| Google OAuth app review | Medium | `drive.file` scope keeps review light; start the verification early |
| Store reviewers see a "mirror tool" as piracy-adjacent | Medium | Clear description, users' own accounts, honest privacy policy |
| Host blocks extension requests (CORS, headers) | Low–medium | Extensions with host permissions bypass CORS; test in M0/M1 |

## Public release (decided 2026-10-17: EasyMirror will be published for anyone to use)

The design already fits: there is no server, and every user signs in to their own accounts directly from their browser. What a public release adds:

- **Google and Yandex app registration is a one-time publisher task.** Users never see it; they just click Connect. The client IDs ship inside the extension.
- **Google: move the app from "Testing" to "In production".** Testing allows only 100 hand-picked test users. Production needs a privacy policy URL, a homepage and possibly brand verification. `drive.file` should count as a non-sensitive scope, so no paid security assessment; confirm this in the Google console.
- **Each store assigns its own extension ID.** That means a different sign-in redirect URL for Chrome Web Store, Edge Add-ons and Firefox. Register all of them with Google and Yandex next to the dev ID `naicmlgekdnneapgfjkgialddpojebgd`.
- **Store listings need:**
  - a privacy policy (what's stored and where: keys and tokens stay in the browser, files go only to hosts the user picks),
  - a justification for each permission, especially optional all-sites access and `webRequest`,
  - screenshots and a clear description ("move files between your own storage accounts").
- **Developer accounts:** Chrome Web Store (one-time fee), Edge Partner Center (free), Firefox Add-ons (free; reviewers ask for the source code and build steps because the code is bundled).
- **Host terms:**
  - Catbox forbids commercial use without approval. EasyMirror is free, but it's worth emailing the owner before launch.
  - GoFile asks apps to reuse one account rather than create one per upload. EasyMirror already does this, one guest account per user.
- **Upkeep:** hosts change their APIs (GoFile's is in beta), so plan on occasional fixes.
- **Publisher contact:** Google and Yandex show the app's support email on the sign-in screen, so consider a dedicated address rather than a personal one.

## What you'll need to do (can't be done for you)
- Create a **Google Cloud OAuth client** for Drive sign-in.
- Register a **Yandex OAuth app** at oauth.yandex.com.
- Create test accounts on Pixeldrain, Google, Yandex (and keep the keys out of the repo).
- Later: Chrome Web Store developer account (one-time fee) and a Firefox Add-ons account.
