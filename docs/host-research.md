# EasyMirror — host research (2026-10-17)

Goal: browser extension that mirrors a file from a link to the user's chosen hosts. Users own their accounts; we only move the file.

Legend
- **Upload**: how an extension can upload to it.
- **As source**: how we get the file *out* of it. "Page flow" = open the host's page, user clicks through timers/captchas, extension catches the download.
- **Remote upload**: the destination host can fetch a direct URL itself, so the bytes never pass through the user's connection.

| Host | Status | Upload | Account | As source | Remote upload | rclone | Confidence |
|---|---|---|---|---|---|---|---|
| **GoFile** | Alive, API in beta | Official API (`upload.gofile.io`). Changed with breaking changes late 2025 | Optional (guest token, or account token) | Page flow likely; reading content via API is premium-only | No (not found) | Yes | Medium |
| **Catbox** | Alive | Simple POST to `catbox.moe/user/api.php` | Optional (userhash) | Direct links, easy | Yes (`reqtype=urlupload`) | No | Medium (200 MB cap, from third-party sources) |
| **Pixeldrain** | Alive | Official API, `PUT /api/file/{name}` | **Required** (API key). Anonymous upload is no longer supported. New accounts need a verified email | Official API `GET /api/file/{id}`; captcha when rate-limited; hotlinking needs premium | No | Yes | High (official docs) |
| **Google Drive** | Alive | Official API, OAuth | Required (OAuth sign-in) | Official API; large public files have a confirm page | No | Yes | High |
| **Yandex.Disk** | Alive | Official REST API (get upload URL, then PUT) | Required (OAuth) | Official public-download API, no auth needed | Yes (upload by URL) | Yes | High |
| **MEGA** | Alive | Via `megajs` library (unofficial, handles encryption, works in browser) | Required | `megajs` can download shared links | No | Yes | Medium (upload needs the library's newer low-level flow) |
| **Mixdrop** | Alive | Official API, `POST ul.mixdrop.ag/api` | Required (email + API key) | Page flow (video-streaming host) | Yes (`/remoteupload`) | No | High (official docs) |
| **1Fichier** | Alive | Official API (`api.1fichier.com/v1`) | Required, and the **API needs a Premium subscription** | Page flow for free users (wait timer) | Yes (premium) | Yes | Medium |
| **Mail.ru Cloud** | Alive | Unofficial (WebDAV / reverse-engineered web API) | Required (app password) | Unofficial | No | Yes | Low–medium; can break without notice |
| **FileDitch** | Probably alive | Undocumented endpoint (`up1.fileditch.com/temp/upload.php`) | None | Direct links | No | No | Low |
| **Send.cm** | Alive (API page blocked our fetch) | API claimed on third-party listings, not verified | Optional? | Page flow | Claimed | No | Low |
| **HexUpload** | **Renamed/moved**: `hexupload.net` redirects to `hexload.com`, API page returned server error | Unknown | Unknown | Page flow | Unknown | No | Low |
| **Krakenfiles** | Unknown (site blocked our fetch) | No public API found | Unknown | Page flow | Unknown | No | Low |
| **MediaFire** | Alive | Old Core API 1.5; new app registration may be closed | Required | Page flow (download button page) | Unknown | No | Low |
| **SendSpace** | Alive (site), dev API pages 404 | Old developer API, probably not issuing keys | Required for API | Page flow | No | No | Low |
| **Clicknupload** | Unknown | No public API found | Required | Page flow (timer + captcha) | Unknown | No | Low |
| **Daily Uploads** | Unknown | XFileSharing-based site; API keys are issued by the site admin, not users | Required | Page flow | Unknown | No | Low |

## Takeaways

1. **The account requirement isn't a blocker.** The hosts that need accounts (Pixeldrain, Google Drive, Yandex, MEGA, Mixdrop) are the ones with the best APIs.
2. **The real dividing line is "official API" vs "no API".** The bottom half of the table would need us to imitate the website, which breaks whenever the site changes.
3. **Remote upload is a big win.** When the source is a direct link, Catbox, Mixdrop, Yandex.Disk and 1Fichier (premium) can fetch it themselves. No bandwidth or memory is used on the user's side, which also solves the large-file worry for those hosts.
4. **1Fichier's API is premium-only**, so it's an "if you have premium" option.
5. **The page flow is the universal fallback for sources.** Hosts with timers and captchas still work as sources if the user clicks through the page themselves.

## Recommended starting set (v1)

**Destinations:** GoFile, Catbox, Pixeldrain, Google Drive, Yandex.Disk
- Covers: no account (GoFile, Catbox), API key (Pixeldrain), OAuth (Drive, Yandex), and remote upload (Catbox, Yandex).

**Sources:** any direct URL, plus Google Drive, Yandex.Disk, Pixeldrain, Catbox, GoFile, and the generic page flow for everything else.

**v2:** MEGA, Mixdrop, 1Fichier (premium), Mail.ru.
**Later / only if demand:** the low-confidence hosts. Each needs a live check first.

## Unverified / to check before building
- ~~GoFile's current API~~ and ~~Catbox's size limit~~: confirmed in M0, see [m0-results.md](m0-results.md).
- Whether HexUpload → hexload.com is the same service.
- Krakenfiles, Send.cm, Clicknupload, Daily Uploads: whether they're up at all.

## Update 2026-10-17: more destinations

Checked the API endpoints live (read-only requests, no uploads). Upload formats confirmed against the hosts' docs where reachable, otherwise against [PolyUploader](https://github.com/spel987/PolyUploader) (GPL-3.0, used as a reference only, no code copied). Size and retention figures marked † are from PolyUploader's notes, not the hosts.

| Host | Decision | Upload | Account | Notes |
|---|---|---|---|---|
| **Buzzheavier** (new) | Added. Real upload worked 2026-10-17 | `PUT https://w.buzzheavier.com/{name}` → `data.id`, link `buzzheavier.com/{id}` | None (optional token not used yet) | No size limit †, kept ~45 days † |
| **VikingFile** (new) | Added. Real upload worked 2026-10-17 | `GET /api/get-server`, then POST `file` + `user=""` to that server → `url` | None (optional user hash not used yet) | ~10 GB †, ~15 days † |
| **Krakenfiles** | Built, switched off (`KRAKENFILES_ENABLED`). On 2026-10-17 all 11 upload servers we tried (hs1–hs15.krakencloud.net) refused connections from our network, and the home page said "Sorry, service unavailable". Retry, then turn on | `GET /api/server/available`, then POST `files[]` to the node's `/_uploader/gallery/upload` → `files[0].url` (site-relative) | None. The account API (`X-AUTH-TOKEN`) is not used yet | 1 GB (krakenfiles.com home page). The anonymous uploader is the website's, not a documented API, so it may change |
| **Clicknupload, Send.now (was Send.cm), Daily Uploads, HexUpload (hexload.com)** | Added, one shared adapter. Needs a real-account test | XFileSharing API: `GET /api/upload/server?key=` → `sess_id` + upload URL; POST `sess_id`, `utype`, `file_0` → `[{file_code}]`, link `{site}/{file_code}`. All four answered `/api/account/info` with "Invalid key" for a fake key | User's own API key | Upload servers are on other, changing domains (covered by the all-sites permission) |
| **Mixdrop** | Later | `POST ul.mixdrop.ag/api` with email + key | Required | Video host; may refuse other files |
| **Bunkr** | Later | Token + `/api/node`, then chunked Dropzone-style upload and `/api/upload/finishchunks` | Required | Needs chunked uploads in the engine |
| **FileDitch** | Skip | Site redesigned (new.fileditch.com), no documented upload | — | |
| **MEGA, 1Fichier, Mail.ru, MediaFire, SendSpace** | Skip | See the table above | | |

Temporary hosts (Litterbox, Uguu, tmpfiles, temp.sh) were left out: files vanish within hours or days, which doesn't suit mirroring.

## Sources
- rclone backend list: https://rclone.org/overview/
- Pixeldrain API: https://pixeldrain.com/api
- Mixdrop API: https://mixdrop.ag/api
- GoFile API: https://gofile.io/api
- Yandex.Disk API: https://yandex.com/dev/disk-api/doc/en/
- megajs: https://mega.js.org/docs/1.0/tutorial/intro
- rclone 1Fichier (premium required): https://rclone.org/fichier/
- rclone Mail.ru (app password): https://rclone.org/mailru
- MediaFire API status discussion: https://with.raidrive.com/t/new-storage-mediafire/182
- XFileSharing API keys: https://sibsoft.net/kb/leeching-from-xfilesharingpowered-sites-a98.html
