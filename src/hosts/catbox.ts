import { extensionOf, formatBytes } from '@/engine/filename';
import { endpoints } from './endpoints';
import type { Destination } from './types';

// From catbox.moe (home page and FAQ), checked 2026-10-17.
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_GIF_BYTES = 20 * 1024 * 1024;
const BLOCKED = ['exe', 'scr', 'cpl', 'jar'];
/** Optional: the user's Catbox userhash, so uploads are kept permanently. */
export const USERHASH_KEY = 'hosts.catbox.userhash';

export const catbox: Destination = {
  id: 'catbox',
  label: 'Catbox',
  note: 'up to 200 MB',
  maxBytes: MAX_BYTES,

  async connected() {
    return true;
  },

  check({ name, size }) {
    const ext = extensionOf(name);
    if (BLOCKED.includes(ext) || ext.startsWith('doc')) return `Catbox doesn't accept .${ext} files`;
    if (size !== undefined && size > MAX_BYTES) return `Catbox takes files up to 200 MB (this one is ${formatBytes(size)})`;
    if (ext === 'gif' && size !== undefined && size > MAX_GIF_BYTES) return 'Catbox takes GIFs up to 20 MB';
    return undefined;
  },

  async buildUpload() {
    const userhash = (await browser.storage.local.get(USERHASH_KEY))[USERHASH_KEY] as string | undefined;
    return {
      label: 'catbox',
      kind: 'multipart',
      url: endpoints.catboxApi,
      field: 'fileToUpload',
      fields: { reqtype: 'fileupload', ...(userhash ? { userhash } : {}) },
      maxBytes: MAX_BYTES,
    };
  },

  async parseResponse(status, body) {
    const text = body.trim();
    if (status >= 200 && status < 300 && /^https?:\/\//.test(text)) return text;
    throw new Error(`Catbox refused the upload${text ? `: ${text.slice(0, 200)}` : ` (HTTP ${status})`}`);
  },
};
