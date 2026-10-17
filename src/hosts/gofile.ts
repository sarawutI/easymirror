import { endpoints } from './endpoints';
import type { Destination } from './types';

// API docs: https://gofile.io/api (beta), checked 2026-10-17.
// The first upload without a token creates a guest account; we keep its token so
// later mirrors land in the same account instead of minting one per upload.
export const TOKEN_KEY = 'hosts.gofile.token';
/** 'guest' when EasyMirror created the account, 'user' when the user pasted their own token. */
export const TOKEN_KIND_KEY = 'hosts.gofile.tokenKind';

async function savedToken(): Promise<string | undefined> {
  return (await browser.storage.local.get(TOKEN_KEY))[TOKEN_KEY] as string | undefined;
}

export const gofile: Destination = {
  id: 'gofile',
  label: 'GoFile',
  note: 'No account needed',

  async connected() {
    return true;
  },

  check() {
    return undefined;
  },

  async buildUpload() {
    const token = await savedToken();
    // No folderId: each mirror gets its own public folder, so its share link
    // doesn't show the user's other mirrors.
    return {
      label: 'gofile',
      kind: 'multipart',
      url: endpoints.gofileUpload,
      field: 'file',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    };
  },

  async parseResponse(status, body) {
    let json: any;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`GoFile sent an unexpected answer (HTTP ${status})`);
    }
    // GoFile can answer HTTP 200 with an error status, so branch on `status`.
    if (json?.status !== 'ok') {
      const reason = json?.status ?? `HTTP ${status}`;
      if (reason === 'error-rateLimit') throw new Error('GoFile is rate-limiting uploads; try again in a few minutes');
      if (reason === 'error-limits') throw new Error('Your GoFile account is full (10,000 files on free accounts)');
      throw new Error(`GoFile refused the upload (${reason})`);
    }
    const data = json.data ?? {};
    const guestToken = data.guestToken ?? json.guestToken;
    if (guestToken && !(await savedToken())) await browser.storage.local.set({ [TOKEN_KEY]: guestToken, [TOKEN_KIND_KEY]: 'guest' });
    if (!data.downloadPage) throw new Error('GoFile accepted the file but sent no link');
    return data.downloadPage as string;
  },
};
