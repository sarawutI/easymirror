import type { OAuthProvider } from './oauth';

// Client IDs come from .env.local (see .env.example and docs/account-setup.md).
// They are not secrets: OAuth client IDs are visible to anyone who installs the extension.

export const googleProvider: OAuthProvider = {
  id: 'google',
  name: 'Google Drive',
  clientId: import.meta.env.WXT_GOOGLE_CLIENT_ID || undefined,
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  // drive.file: only files and folders EasyMirror itself creates.
  params: (silent) => ({
    scope: 'https://www.googleapis.com/auth/drive.file',
    include_granted_scopes: 'true',
    prompt: silent ? 'none' : 'select_account',
  }),
  silentRefresh: true,
};

export const yandexProvider: OAuthProvider = {
  id: 'yandex',
  name: 'Yandex.Disk',
  clientId: import.meta.env.WXT_YANDEX_CLIENT_ID || undefined,
  authorizeUrl: 'https://oauth.yandex.com/authorize',
  // Scopes are fixed when the app is registered (app folder access only).
  // Tokens last about a year, so there is no silent refresh.
  params: (silent): Record<string, string> => (silent ? {} : { force_confirm: 'yes' }),
  silentRefresh: false,
};
