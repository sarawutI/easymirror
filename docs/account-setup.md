# Account setup (one time)

> **Only needed when Google Drive and Yandex.Disk are switched on.** They're off in release builds for now; set `OAUTH_HOSTS_ENABLED = true` in `src/features.ts` when you're ready. Doing that also gives the extension the fixed ID below and the sign-in permission. GoFile, Catbox and Pixeldrain need none of this.

Pixeldrain only needs an API key, pasted in EasyMirror's Settings page. Google Drive and Yandex.Disk need EasyMirror to be **registered as an app** with Google and Yandex once. Each gives you a **client ID**, which goes into `.env.local`. These steps need your own Google and Yandex accounts.

Throughout, the **redirect URL** is:

```
https://naicmlgekdnneapgfjkgialddpojebgd.chromiumapp.org/
```

It's fixed by the `key` in `wxt.config.ts`. To double-check it in your browser, open EasyMirror Settings, expand **Developer details** at the bottom and copy the URL shown there. If it's different, register that one instead (or as well).

## 0. Reinstall the extension once

The extension now has a fixed ID, which is different from the ID it had before. In `edge://extensions`, **remove** EasyMirror, then **Load unpacked** `.output/chrome-mv3` again. The card should show ID `naicmlgekdnneapgfjkgialddpojebgd`. This clears the old history and GoFile guest account.

## 1. Pixeldrain (no app registration)

1. Sign in at [pixeldrain.com](https://pixeldrain.com). Accounts registered after 2026-09-01 must verify their email before they can upload.
2. Go to [pixeldrain.com/user/api_keys](https://pixeldrain.com/user/api_keys) and create a key.
3. In EasyMirror: popup → **Settings** → Pixeldrain → paste the key → **Save**. It should say "Connected as <your username>".

## 2. Google Drive

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project, e.g. "EasyMirror".
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **Google Auth Platform** (the OAuth consent screen): click **Get started**.
   - App name: `EasyMirror`, user support email: yours.
   - Audience: **External**.
   - Contact email: yours. Accept the policy, then **Create**.
4. **Data access → Add or remove scopes**: add `https://www.googleapis.com/auth/drive.file` ("See, edit, create and delete only the specific Google Drive files you use with this app"), then **Save**.
5. **Audience → Test users → Add users**: add your own Google address. While the app is in "Testing", only test users can sign in, and Google shows an "unverified app" warning you can click through.
6. **Clients → Create client**:
   - Application type: **Web application**, name: `EasyMirror extension`.
   - **Authorized redirect URIs → Add URI**: the redirect URL above, including the trailing `/`.
   - **Create**, then copy the **Client ID** (ends in `.apps.googleusercontent.com`). You don't need the client secret.

## 3. Yandex.Disk

1. Open [oauth.yandex.com/client/new](https://oauth.yandex.com/client/new) and sign in with your Yandex account.
2. Service name: `EasyMirror`. Platform: **Web services**.
3. **Redirect URI**: the redirect URL above.
4. **Data access**, under Yandex.Disk REST API, tick:
   - **Access to app folder on Yandex.Disk** (`cloud_api:disk.app_folder`). EasyMirror only uses this folder.
   - **Access to information about Yandex.Disk** (`cloud_api:disk.info`). This shows your name in Settings.
5. Create the app and copy its **ClientID**.

Files will land in `Applications/EasyMirror` on your Disk. The folder is named after the service name in step 2.

## 4. Put the IDs in the build

Copy `.env.example` to `.env.local` and fill in:

```
WXT_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
WXT_YANDEX_CLIENT_ID=0123456789abcdef0123456789abcdef
```

Then rebuild and reload the extension:

```bash
npm run build
```

In `edge://extensions`, click **Reload** on EasyMirror. Then go to Settings → **Connect** for Google Drive and Yandex.Disk.

## Troubleshooting

| What you see | Likely cause |
|---|---|
| `redirect_uri_mismatch` (Google) | The redirect URI in step 2.6 doesn't exactly match. Check the trailing `/` and the ID. |
| "Access blocked: app has not completed verification" | Your address isn't in **Test users** (step 2.5). |
| Yandex says the redirect URI is invalid | Step 3.3 doesn't match the redirect URL. |
| "sign-in isn't set up in this build" | `.env.local` is missing an ID, or you didn't rebuild and reload after adding it. |
| Google Drive asks you to reconnect | Google tokens last 1 hour. EasyMirror renews them quietly, but needs you to sign in again if Google asks. |
