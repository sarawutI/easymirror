import { accessToken } from '@/accounts/oauth';
import { googleProvider } from '@/accounts/providers';
import { getAccount } from '@/accounts/store';
import { endpoints } from './endpoints';
import type { Destination } from './types';

// Drive API v3, resumable uploads. Scope drive.file: EasyMirror only sees files and
// folders it created, which is why it keeps its own "EasyMirror" folder.
const FOLDER_NAME = 'EasyMirror';
const FOLDER_KEY = 'hosts.googledrive.folderId';
export const SHARE_KEY = 'hosts.googledrive.shareLink';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function api(path: string, init: RequestInit & { token: string }): Promise<any> {
  const res = await fetch(`${endpoints.googleApi}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${init.token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw driveError(res.status, json);
  return json;
}

function driveError(status: number, json: any): Error {
  const reason = json?.error?.errors?.[0]?.reason ?? json?.error?.status;
  if (status === 401) return new Error('Your Google Drive sign-in has expired. Reconnect it in EasyMirror settings.');
  if (reason === 'storageQuotaExceeded') return new Error('Your Google Drive is full');
  if (reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded' || status === 429)
    return new Error('Google Drive is rate-limiting uploads; try again in a few minutes');
  return new Error(`Google Drive refused the upload (${json?.error?.message ?? `HTTP ${status}`})`);
}

/** The EasyMirror folder in the user's Drive, created on first use. */
async function folderId(token: string): Promise<string> {
  const cached = (await browser.storage.local.get(FOLDER_KEY))[FOLDER_KEY] as string | undefined;
  if (cached) return cached;
  const q = `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const found = await api(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, { token });
  const id: string =
    found.files?.[0]?.id ??
    (await api('/drive/v3/files?fields=id', { token, method: 'POST', body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }) })).id;
  await browser.storage.local.set({ [FOLDER_KEY]: id });
  return id;
}

async function openSession(token: string, name: string, folder: string, size?: number, type?: string): Promise<Response> {
  return fetch(`${endpoints.googleApi}/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      ...(type ? { 'X-Upload-Content-Type': type } : {}),
      ...(size !== undefined ? { 'X-Upload-Content-Length': String(size) } : {}),
    },
    body: JSON.stringify({ name, parents: [folder] }),
  });
}

/** Signed-in user's address, for the settings page. */
export async function googleAccountLabel(token: string): Promise<string> {
  const about = await api('/drive/v3/about?fields=user(emailAddress,displayName)', { token });
  return about.user?.emailAddress ?? about.user?.displayName ?? 'your account';
}

export const googledrive: Destination = {
  id: 'googledrive',
  label: 'Google Drive',
  note: 'saved in an "EasyMirror" folder',
  needsAccount: true,

  async connected() {
    return !!(await getAccount('google'));
  },

  check() {
    return undefined;
  },

  async buildUpload(info) {
    const token = await accessToken(googleProvider);
    let folder = await folderId(token);
    let res = await openSession(token, info.name, folder, info.size, info.type);
    if (res.status === 404) {
      // The user deleted the folder; make a new one.
      await browser.storage.local.remove(FOLDER_KEY);
      folder = await folderId(token);
      res = await openSession(token, info.name, folder, info.size, info.type);
    }
    if (!res.ok) throw driveError(res.status, await res.json().catch(() => ({})));
    const session = res.headers.get('Location');
    if (!session) throw new Error("Google Drive didn't open an upload session");
    return { label: 'googledrive', kind: 'put', url: session, headers: { Authorization: `Bearer ${token}` } };
  },

  async parseResponse(status, body) {
    let json: any = {};
    try {
      json = JSON.parse(body);
    } catch {
      // handled below
    }
    if (status < 200 || status >= 300 || !json.id) throw driveError(status, json);
    const share = (await browser.storage.local.get(SHARE_KEY))[SHARE_KEY] !== false;
    if (share) {
      const token = await accessToken(googleProvider);
      await api(`/drive/v3/files/${json.id}/permissions?fields=id`, {
        token,
        method: 'POST',
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      });
    }
    return (json.webViewLink as string) ?? `https://drive.google.com/file/d/${json.id}/view`;
  },
};
