# M0 spike results (2026-10-17)

Run with `npm run build:spike` then `npm run spike:run` (Playwright's Chromium, headless, against the local test server in `spikes/server.mjs`).

## 1. Large files through the browser — passed

One download saved to the browser's private disk area (OPFS) in an offscreen document, then uploaded to **two** destinations in parallel: one raw `PUT` (like Pixeldrain) and one multipart `POST` (like GoFile/Catbox). The service worker was force-stopped at ~30% of every transfer.

| Size | Result | Time (local) | Both uploads' SHA-256 match source | Engine JS heap peak | Browser memory change |
|---|---|---|---|---|---|
| 100 MB | done | 1.1 s | yes | 17.9 MB | (too fast to sample) |
| 1 GB | done | 5.6 s | yes | 27.5 MB | +0.1 GB |
| 5 GB | done | 26.6 s | yes | 27.5 MB | +0.1 GB |

What this shows:
- **Memory doesn't grow with file size.** Files go to disk and uploads stream from disk, including multipart `FormData`.
- **Stopping the service worker doesn't break a transfer.** The offscreen document keeps running, and its progress messages wake the worker back up.
- **One download can feed several destinations.**
- `XMLHttpRequest` gives upload progress (fetch can't), and it works with disk-backed files.

The times only reflect local disk and loopback speed. Real hosts will be limited by the user's connection.

## 2. Page flow (hosts with timers / buttons) — passed, with one expected limit

A fake host page sets a `SameSite=Lax` session cookie, shows a 2-second countdown, then a Download button. The runner clicks it, standing in for the user.

| Variant | Result | Notes |
|---|---|---|
| Plain download link | **done**, hash match | Extension paused the browser's download, refetched with the user's cookie, cancelled the browser copy |
| Form POST button (common on XFileSharing hosts) | **done**, hash match | The POST body was captured with non-blocking `webRequest` and replayed |
| Single-use link | **fallback-needed** (expected) | Refetch got HTTP 410; the browser's paused download was resumed and **completed**, so the user still has the file |

What this shows:
- The extension's own fetch **sends the host's session cookie**, so links tied to a session still work.
- **Pause, then decide** is the right pattern: cancel the browser's copy only after our fetch has succeeded, otherwise resume it.
- **Single-use links can't be refetched.** The browser's request already used the token. v1 handles this by letting the browser finish and asking the user to pick the downloaded file. Some real hosts will hit this path.

## 3. Host APIs — confirmed

**GoFile** (official docs, gofile.io/api, read 2026-10-17)
- Upload: `POST https://upload.gofile.io/uploadfile`, multipart, field `file`, optional `folderId`, token as `Authorization: Bearer`.
- No token → a guest account is created and `guestToken` + `parentFolder` come back. **Reuse them; don't create an account per upload.**
- CORS-enabled. Response envelope `{status, data}`: always check `status`, not just the HTTP code. Share link is `data.downloadPage`.
- Free accounts are capped at 10,000 stored items. Reading folders and direct links are **Premium-only**, so as a *source*, GoFile uses the page flow.
- The API is still marked beta.

**Catbox** (official tools, FAQ and home pages)
- Upload: `POST https://catbox.moe/user/api.php`, `reqtype=fileupload`, field `fileToUpload`, optional `userhash`. Remote: `reqtype=urlupload` with `url`.
- **Max 200 MB** (confirmed on the home page). GIFs max 20 MB.
- **Blocked file types:** `.exe`, `.scr`, `.cpl`, `.doc*`, `.jar`. Content rules also ban full TV/anime episodes. The adapter should check type and size *before* uploading and explain why.
- Anonymous files are deleted after 2 years without views; files uploaded to an account are kept.
- Some countries and ISPs block Catbox (e.g. Australia, some US ISP "security" filters). Show a helpful error when it's unreachable.

## Not covered yet (needs follow-up)
- **Real hosts' page flows.** Only the simulated host was tested. Real hosts add redirects, JS-triggered downloads and ad pop-ups. Check 2–3 real ones by hand during M3.
- **Firefox.** Firefox has no offscreen documents; the engine would run in its background page. Check in M5.
- **Users who block third-party cookies.** The cookie test ran with Chromium's default settings.
- **Network failures mid-transfer** (resume/retry). Not in M0; planned for M4.

## Conclusion
No blockers. A desktop helper isn't needed for big files, and the plan's architecture holds.
