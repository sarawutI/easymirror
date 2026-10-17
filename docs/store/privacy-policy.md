<!--
Published by GitHub Pages at https://sarawuti.github.io/easymirror/store/privacy-policy.html
(the stores link there). Change "Last updated" whenever this text changes.
Keep it in sync with the code: if a version adds analytics, a server, or Google
Drive / Yandex.Disk sign-in (src/features.ts), this policy must be updated first.
Google sign-in in particular requires a "Limited Use" statement for Google user data.
-->

# EasyMirror Privacy Policy

_Last updated: 17 October 2026_

EasyMirror is a browser extension that copies a file from a link to file-hosting services you choose, and gives you the new share links. This policy explains what EasyMirror does with your data.

**The short version:** EasyMirror has no server. The developer never receives your files, your keys or any information about how you use the extension, unless you choose to send a problem report (see "Reporting a problem" below). Everything else happens in your browser, between the site the file comes from and the hosting services you pick.

## What EasyMirror stores on your device

EasyMirror keeps the following in your browser's extension storage, on your device only:

- **Your settings:** which hosting services you last chose.
- **Keys and tokens you add:** API keys for Pixeldrain, Clicknupload, Send.now, Daily Uploads and HexUpload, a GoFile account token and a Catbox userhash, if you add them in Settings. If you use GoFile without your own account, EasyMirror also keeps the token of the anonymous GoFile guest account it creates for you.
- **Mirror history:** for each mirror, the source link, file name, size, progress, the new share links and any error messages. It stays until you press "Clear finished" or uninstall the extension.
- **Temporary file copies:** while a mirror is running, the file is held in the extension's private browser storage so it can be uploaded to several services. It is deleted when that mirror finishes or fails.

This data is not synced to other devices and is not sent to the developer.

## Where your data goes

EasyMirror only sends data where it has to, to do what you asked:

1. **The site the file comes from.** EasyMirror downloads the file from the link you give it, the same way your browser would. That includes the cookies your browser already has for that site, since some sites only let signed-in visitors download.
2. **The hosting services you choose.** EasyMirror uploads the file and its name to each service you select, along with the key or token you added for that service, if any. Each service's own privacy policy and terms apply to files you upload there:
   - GoFile: https://gofile.io/privacy and https://gofile.io/terms
   - Catbox: https://catbox.moe/legal.php
   - Buzzheavier: https://buzzheavier.com/terms
   - VikingFile: https://vikingfile.com/terms
   - Pixeldrain: https://docs.pixeldrain.com/questions_and_answers/ and https://docs.pixeldrain.com/content_policy/
   - Clicknupload: https://clicknupload.click/tos.html
   - Send.now: https://send.now/terms
   - Daily Uploads: https://dailyuploads.net/tos.html
   - HexUpload: https://hexload.com/tos.html

EasyMirror sends nothing anywhere else on its own. It has no analytics, ads or tracking, and it does not sell or share your data with anyone.

## Reporting a problem

The popup and Settings page have a "Report a problem" link, and a failed mirror has a "Report this problem" button. They open a page that shows the technical details that would go with your report, then opens our feedback form (hosted by Tally) in a new tab:

- **What's included by default:** the EasyMirror version, your browser's user-agent string, which hosting services are set up (not your keys), and the time, status, size and error messages of your last 5 mirrors.
- **What's left out unless you tick the box:** file names, source links and share links.
- You can see exactly what will be included before anything happens, and untick "Include technical details" to send none.
- **Nothing is sent until you submit the form yourself.** The details are placed in the form's address when it opens, so the form provider receives them when the form page loads, but they reach the developer only if you submit it. If you close the tab, nothing is submitted.

What you submit is stored by Tally under its privacy policy (https://tally.so/help/privacy-policy) and is used only to fix problems and improve EasyMirror. To have a report deleted, write to sarawut.det11@gmail.com.

## Donations

The "Support EasyMirror" link opens the developer's Ko-fi page (https://ko-fi.com/sarawut96007) in a new tab. EasyMirror sends Ko-fi no data. If you donate, Ko-fi's privacy policy applies: https://more.ko-fi.com/privacy

## Watching a page for a download

Some sites hide the real file link behind a download page. When you ask EasyMirror to catch the next download on a page (or paste a link that turns out to be a download page), EasyMirror watches **that one browser tab** until you click the site's download button:

- It notes the web addresses that tab requests, and the contents of forms submitted in it, so it can repeat the download request itself.
- When the download starts, EasyMirror pauses your browser's download, fetches the file itself, then cancels the browser's copy. If it can't fetch the file, it lets your browser finish the download instead and asks you to choose the downloaded file.
- What it notes is kept in temporary memory and discarded as soon as the download starts, the tab is closed, or you cancel.

EasyMirror does not look at other tabs, and it doesn't touch downloads you start without asking it to.

## Permissions

| Permission | Why EasyMirror needs it |
|---|---|
| Storage | Saves your settings, keys and mirror history on your device. |
| Offscreen document | Runs large transfers in the background, so they keep going when the popup is closed. |
| Downloads | Takes over the download you start on a page you asked EasyMirror to watch. |
| Web requests | Notes the requests of a tab you asked EasyMirror to watch, so it can repeat the download (see above). |
| Context menus | Adds "Mirror with EasyMirror" to the right-click menu. |
| Notifications | Tells you when a mirror is finished or needs your attention. |
| Access to the hosting services' sites (gofile.io, catbox.moe, buzzheavier.com, vikingfile.com, pixeldrain.com, clicknupload.click, send.now, dailyuploads.net, hexload.com) | Uploads files to those services and checks the keys you add. |
| Access to all sites (asked the first time you mirror) | Downloads the file from whichever site your link points to. Only used for links you mirror. |

## Deleting your data

- **Mirror history:** press "Clear finished" in the popup.
- **Keys and tokens:** remove them on the Settings page.
- **Everything:** uninstalling EasyMirror deletes all of its data from your browser.
- **A report you submitted:** write to sarawut.det11@gmail.com and it will be deleted.

Files you uploaded stay on the hosting services. Delete them there, following each service's rules.

## Children

EasyMirror is not directed at children under 13 and does not knowingly handle their personal information.

## Changes to this policy

If EasyMirror's data handling changes, this page will be updated before that version is released, and the date at the top will change.

## Contact

Questions about this policy: sarawut.det11@gmail.com
Publisher: Sarawut Detyotdee
