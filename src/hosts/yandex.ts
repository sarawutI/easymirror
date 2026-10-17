import { accessToken } from '@/accounts/oauth';
import { yandexProvider } from '@/accounts/providers';
import { getAccount } from '@/accounts/store';
import { endpoints } from './endpoints';
import type { Destination } from './types';

// Yandex.Disk REST API, checked 2026-10-17. The app is registered with app-folder
// access only, so files go to Disk's "Applications/<app name>" folder ("app:/").
// Upload is two steps: ask for an upload URL, then PUT the file there (no token
// needed for the PUT). Afterwards we publish it to get a public link.
const MAX_NAME_ATTEMPTS = 20;

async function api(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${endpoints.yandexApi}${path}`, { ...init, headers: { Authorization: `OAuth ${token}`, ...init.headers } });
}

async function yandexError(res: Response): Promise<Error> {
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) return new Error('Your Yandex.Disk sign-in has expired. Reconnect it in EasyMirror settings.');
  if (res.status === 507 || json?.error === 'DiskInsufficientStorageError') return new Error('Your Yandex.Disk is full');
  return new Error(`Yandex.Disk refused the upload (${json?.description ?? json?.message ?? `HTTP ${res.status}`})`);
}

/** "clip.mp4" → "clip (1).mp4" for the nth attempt. */
export function numberedName(name: string, n: number): string {
  if (n === 0) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/** Signed-in user's login, for the settings page. */
export async function yandexAccountLabel(token: string): Promise<string> {
  const res = await api('/', token);
  if (!res.ok) throw await yandexError(res);
  const disk = await res.json();
  return disk.user?.display_name || disk.user?.login || 'your account';
}

export const yandex: Destination = {
  id: 'yandex',
  label: 'Yandex.Disk',
  note: 'Your account · 1 GB per file (50 GB with Yandex 360)',
  needsAccount: true,

  async connected() {
    return !!(await getAccount('yandex'));
  },

  check() {
    return undefined; // the 1 GB / 50 GB limit depends on the user's plan; the host reports it
  },

  async buildUpload(info) {
    const token = await accessToken(yandexProvider);
    // Don't overwrite: pick the first free name.
    for (let n = 0; n < MAX_NAME_ATTEMPTS; n++) {
      const path = `app:/${numberedName(info.name, n)}`;
      const res = await api(`/resources/upload?path=${encodeURIComponent(path)}&overwrite=false`, token);
      if (res.status === 409) continue;
      if (!res.ok) throw await yandexError(res);
      const link = await res.json();
      return { label: 'yandex', kind: 'put', url: link.href, meta: { path } };
    }
    throw new Error('Yandex.Disk already has too many files with this name');
  },

  async parseResponse(status, _body, meta) {
    if (status === 413) throw new Error('Too big for Yandex.Disk (1 GB per file, 50 GB with Yandex 360)');
    if (status === 507) throw new Error('Your Yandex.Disk is full');
    if (status !== 201 && status !== 202) throw new Error(`Yandex.Disk refused the upload (HTTP ${status})`);
    const path = meta?.path;
    if (!path) throw new Error('Yandex.Disk upload finished, but EasyMirror lost track of the file');
    const token = await accessToken(yandexProvider);
    const published = await api(`/resources/publish?path=${encodeURIComponent(path)}`, token, { method: 'PUT' });
    if (!published.ok) throw await yandexError(published);
    const info = await api(`/resources?path=${encodeURIComponent(path)}&fields=public_url`, token);
    if (!info.ok) throw await yandexError(info);
    const { public_url } = await info.json();
    if (!public_url) throw new Error('Yandex.Disk saved the file but gave no public link');
    return public_url as string;
  },
};
