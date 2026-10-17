import { getAccount, NotConnectedError } from '@/accounts/store';
import { endpoints } from './endpoints';
import type { Destination } from './types';

// API docs: https://pixeldrain.com/api, checked 2026-10-17. Anonymous uploads are
// gone; every upload needs the user's API key (sent as the Basic-auth password).

const authHeader = (key: string) => `Basic ${btoa(`:${key}`)}`;

const ERRORS: Record<string, string> = {
  authentication_required: 'Pixeldrain needs your API key. Add it in EasyMirror settings.',
  authentication_failed: 'Pixeldrain rejected your API key. Update it in EasyMirror settings.',
  user_out_of_space: 'Your Pixeldrain storage is full',
  file_too_large: 'Too big for your Pixeldrain plan',
  email_address_not_verified: 'Verify your email address on pixeldrain.com before uploading',
  too_many_files: 'Your Pixeldrain account has reached its file limit',
  name_contains_illegal_character: "Pixeldrain doesn't allow some characters in this file name",
  ip_banned: 'Pixeldrain has blocked uploads from your network',
  account_banned: 'Your Pixeldrain account is banned',
};

/** Checks a key and returns the account's username. Used by the settings page. */
export async function verifyPixeldrainKey(key: string): Promise<string> {
  const res = await fetch(`${endpoints.pixeldrainApi}/user`, { headers: { Authorization: authHeader(key) } });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("That API key doesn't work. Copy it again from pixeldrain.com/user/api_keys.");
  if (!res.ok) throw new Error(json?.message ?? `Pixeldrain answered HTTP ${res.status}`);
  return (json.username as string) || 'your account';
}

export const pixeldrain: Destination = {
  id: 'pixeldrain',
  label: 'Pixeldrain',
  note: 'Your account (API key)',
  needsAccount: true,

  async connected() {
    return !!(await getAccount('pixeldrain'));
  },

  check() {
    return undefined; // size limit depends on the user's plan; the host reports it
  },

  async buildUpload(info) {
    const account = await getAccount('pixeldrain');
    if (!account) throw new NotConnectedError('Add your Pixeldrain API key in EasyMirror settings first.');
    return {
      label: 'pixeldrain',
      kind: 'put',
      url: `${endpoints.pixeldrainApi}/file/${encodeURIComponent(info.name)}`,
      headers: { Authorization: authHeader(account.secret) },
    };
  },

  async parseResponse(status, body) {
    let json: any;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`Pixeldrain sent an unexpected answer (HTTP ${status})`);
    }
    if (status >= 200 && status < 300 && json?.id) return `https://pixeldrain.com/u/${json.id}`;
    const code = json?.value as string | undefined;
    throw new Error((code && ERRORS[code]) ?? `Pixeldrain refused the upload (${json?.message ?? code ?? `HTTP ${status}`})`);
  },
};
