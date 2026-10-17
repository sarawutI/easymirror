# Store listing drafts

Copy-paste text for the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons forms. Replace `[BRACKETED]` placeholders. These describe the release build: 11 hosts (GoFile, Catbox, Buzzheavier, VikingFile, 1Fichier, FileDitch without an account; Pixeldrain, Clicknupload, Send.now, Daily Uploads, HexUpload with the user's API key), with Krakenfiles, Google Drive and Yandex.Disk switched off.

Field rules come from the stores' docs (checked 2026-10-17), but the forms change; check the live form for exact labels and limits.

---

## Shared text

### Name

```
EasyMirror
```

### Short summary

For Chrome's summary (132-character limit) and Firefox's summary (250-character limit). This one is 123 characters:

```
Copy a file from any link or download page to GoFile, Catbox, Buzzheavier and 8 more hosts in one click, from your browser.
```

### Detailed description

```
EasyMirror copies a file from a link to the file-hosting services you choose, and gives you the new share links. It runs entirely in your browser, using your own internet connection and, where needed, your own accounts.

HOW IT WORKS
• Paste a link in the popup, or right-click a link and choose "Mirror with EasyMirror".
• Tick where it should go: any of 11 file hosts (see ACCOUNTS below).
• EasyMirror downloads the file once and uploads it to every service you picked at the same time, with progress for each.
• Copy the new links with one click, or all of them at once.

WORKS WITH DOWNLOAD PAGES
Many sites hide the real file behind a page with a Download button. Paste the page link, or open the page and press "Catch the next download on this page". Then click the site's Download button as usual, and EasyMirror takes over that download. If a site only allows a link to be used once, your browser keeps the download and EasyMirror asks you to choose the file to finish.

FEATURES
• Large files: tested with 5 GB files (1Fichier accepts up to 300 GB). Files are kept on disk during the transfer, not in memory, and sent in pieces where the host works that way.
• One download, several uploads in parallel.
• Checks each service's limits first (for example, Catbox's 200 MB limit and blocked file types) and tells you why a service was skipped.
• Clear messages when something goes wrong, per service.
• Notification when a mirror is done.

ACCOUNTS
• No account needed: GoFile, Catbox, Buzzheavier, VikingFile, 1Fichier and FileDitch. You can add your own GoFile token or Catbox userhash in Settings.
• With your own free account and API key, added in Settings: Pixeldrain, Clicknupload, Send.now, Daily Uploads and HexUpload.

PROBLEMS AND FEEDBACK
Something didn't work? Press "Report this problem" on the failed mirror, or "Report a problem" at the bottom of the popup. You'll see exactly which technical details go with your report before anything is sent, and file names and links are left out unless you choose to include them.

PRIVACY
EasyMirror has no server, no analytics and no ads. Your files, links and keys go only to the site the file comes from and the services you choose. Keys and history are stored on your device only. Full policy: https://sarawuti.github.io/easymirror/store/privacy-policy.html

PLEASE NOTE
Only mirror files you have the right to share, and follow each hosting service's terms. EasyMirror is an independent project and is not affiliated with any of the hosting services it supports.
```

### Category

- Chrome Web Store: **Productivity** (or "Tools", depending on the dashboard's current list)
- Edge Add-ons: **Productivity**
- Firefox: **Download Management**

### Support

- Support email: `sarawut.det11@gmail.com`
- Website / support URL: `https://github.com/sarawutI/easymirror`
- Privacy policy URL: `https://sarawuti.github.io/easymirror/store/privacy-policy.html` (published from [privacy-policy.md](privacy-policy.md) by GitHub Pages)

---

## Chrome Web Store: Privacy practices tab

### Single purpose

```
EasyMirror copies a file that the user points it to (a link, or a download the user starts on a file-hosting page) to file-hosting services the user selects, and returns the new share links.
```

### Permission justifications

| Permission | Justification (paste into the field) |
|---|---|
| `storage` | Saves the user's settings, the API keys or tokens they enter for their own hosting accounts, and their mirror history, locally on the device. It also keeps the state of running mirrors so progress survives the service worker restarting. |
| `offscreen` | Runs file transfers in an offscreen document so that large transfers (several GB) keep going when the popup closes and the service worker is suspended. The file is held temporarily in the extension's private storage and uploaded from there. |
| `downloads` | When the user asks EasyMirror to catch a download on a file-hosting page, EasyMirror pauses the download the user starts there, fetches the file itself, then cancels the browser's copy (or resumes it if the file can't be fetched again). Downloads the user didn't ask EasyMirror to catch are ignored. |
| `webRequest` | Non-blocking, and used only for the tab the user asked EasyMirror to watch. It records that tab's request URLs and submitted form fields, so a download started by a form button can be repeated. Requests in other tabs are ignored, and the recorded data is discarded when the download starts or the tab closes. |
| `contextMenus` | Adds "Mirror with EasyMirror" to the right-click menu for links, and "Mirror the next download on this page" for pages. |
| `notifications` | Tells the user when a mirror has finished, failed, or needs them to click a download button or choose a file. |
| Host permissions: `https://*.gofile.io/*`, `https://catbox.moe/*`, `https://*.buzzheavier.com/*`, `https://*.vikingfile.com/*`, `https://*.1fichier.com/*`, `https://*.fileditch.com/*`, `https://pixeldrain.com/*`, `https://*.clicknupload.click/*`, `https://*.send.now/*`, `https://*.dailyuploads.net/*`, `https://*.hexload.com/*` | Uploads the user's file to these file-hosting services through their upload APIs, when the user selects them as destinations, and checks the API keys the user enters in Settings. |
| Optional host permission: `<all_urls>` | Requested at runtime, the first time the user mirrors something. Needed to download the file from whichever site the user's link points to, including the download servers it redirects to, which can be on any domain. Some hosts (Clicknupload, Send.now, Daily Uploads, HexUpload) also hand out upload servers on changing domains. Only used for links and pages the user explicitly mirrors, and for uploads to hosts the user picked. |

### Remote code

```
No, I am not using remote code.
```

All code ships in the package. The extension only sends and receives file data and JSON through the hosting services' APIs.

### Data usage

EasyMirror only sends data to the developer when the user submits a problem report, but Chrome counts data the extension handles and transmits anywhere. Recommended answers:

| Data type | Tick? | Why |
|---|---|---|
| Personally identifiable information | No | |
| Health information | No | |
| Financial and payment information | No | |
| **Authentication information** | **Yes** | The API keys, GoFile token and Catbox userhash the user adds are stored locally and sent only to the service they belong to. |
| Personal communications | No | |
| Location | No | |
| **Web history** | **Yes** (conservative) | Source links stay in local history, except when the user ticks "include file names and links" in a problem report and submits the feedback form. |
| **User activity** | **Yes** (conservative) | The "watch this tab" feature monitors one tab's network requests. It stays local, but this category covers network monitoring. |
| **Website content** | **Yes** | The files the user mirrors are downloaded from websites and uploaded to the chosen services. |

Tick all three certifications. They should read roughly as below; check the dashboard's exact wording:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Images

- Store icon: `public/icon/128.png` (already in the repo).
- Screenshots, **1280×800**, upload in this order:
  1. `store-assets/1-mirror-a-link.png`
  2. `store-assets/2-download-pages.png`
  3. `store-assets/3-big-files.png`
  4. `store-assets/4-your-accounts.png`
- Small promo tile, **440×280**: `store-assets/promo-tile-440x280.png`
- Edge and Firefox accept the same screenshots.

The links and file names in them are sample data. Regenerate with `npm run store-images`.

---

## Edge Add-ons (Partner Center)

Reuse the shared text: name, summary, detailed description, category, privacy policy URL and support details. Edge asks for permission explanations in its own form; reuse the table above. Edge Add-ons is free to join.

---

## Firefox Add-ons (AMO)

Not ready to submit yet: the Firefox build still needs work (milestone M5). Firefox has no offscreen documents, so the transfer engine has to run in the background page there.

When it is ready:
- **Summary:** the short summary above (250-character limit).
- **Description:** the detailed description above.
- **Data collection declaration**, required in the manifest for new extensions. EasyMirror sends credentials and website content to the services the user picks, so in `wxt.config.ts` for the Firefox build:

  ```json
  "browser_specific_settings": {
    "gecko": {
      "id": "[easymirror@YOUR-DOMAIN]",
      "strict_min_version": "140.0",
      "data_collection_permissions": {
        "required": ["authenticationInfo", "websiteContent"]
      }
    }
  }
  ```

  `strict_min_version` 140 avoids having to build a separate consent screen for older Firefox versions.
- **Source code:** AMO asks for the source, because the code is bundled. Upload the repository as a zip, and give these build steps in the reviewer notes:
  `npm ci` then `npx wxt build -b firefox`. Output is in `.output/firefox-mv3`.

---

## Notes for reviewers (all stores)

```
How to test without any account:
1. Click the EasyMirror toolbar icon.
2. Paste a direct file link, for example any https://files.catbox.moe/... link, or a small file from a public site.
3. Leave GoFile and Catbox ticked and click Mirror. When asked, allow access to other sites (needed to download from the link's site).
4. Two share links appear when the upload finishes.

Download pages: open a GoFile download page (https://gofile.io/d/...), click the EasyMirror icon, press "Catch the next download on this page", then click GoFile's Download button. EasyMirror takes over that download.

Buzzheavier, VikingFile, 1Fichier and FileDitch also work without an account. Pixeldrain, Clicknupload, Send.now, Daily Uploads and HexUpload need a free account and API key (Settings page); they're optional.

The extension has no server and no analytics. Optional all-sites access is used only to download the file the user chose to mirror.

"Report a problem" opens an extension page that previews the technical details, then opens an external feedback form in a new tab with those details filled in. Nothing is submitted unless the user submits the form.
```

---

## Before launch: courtesy email to Catbox

Catbox's FAQ says it can't be used for commercial services without approval. EasyMirror is free, but it sends uploads to Catbox from many users and may ask for donations, so ask first. If they say no, remove Catbox from `src/hosts/index.ts`, the host permissions in `wxt.config.ts`, and these drafts. Draft, to send from your own address (find the contact address on catbox.moe):

```
Subject: Free browser extension that uploads to Catbox via your API

Hi,

I've made a free browser extension called EasyMirror. It lets people copy a file from a link to file hosts they choose, and Catbox is one of the options. It uses your documented API (reqtype=fileupload, plus the optional userhash), runs entirely in the user's browser from their own IP, and checks your 200 MB limit and blocked file types before uploading. There are no ads and no paid features, just an optional donation link.

Before I publish it in the Chrome, Edge and Firefox stores, I wanted to check that you're OK with this, and whether there's anything you'd like me to do differently (rate limits, a User-Agent, a link back, or leaving Catbox out).

Thanks for running Catbox,
Sarawut Detyotdee
```
