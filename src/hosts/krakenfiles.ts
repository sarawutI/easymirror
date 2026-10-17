import { formatBytes } from '@/engine/filename';
import { endpoints } from './endpoints';
import type { Destination } from './types';

// Checked 2026-10-17. /api/server/available names an upload node; anonymous uploads
// go to that node's web uploader (/_uploader/gallery/upload, field "files[]"), the
// same one krakenfiles.com uses. Its answer has a site-relative link.
// The 1 GB limit for free uploads is on the krakenfiles.com home page.
const MAX_BYTES = 1024 * 1024 * 1024;

export const krakenfiles: Destination = {
  id: 'krakenfiles',
  label: 'Krakenfiles',
  note: 'No account needed · up to 1 GB',
  maxBytes: MAX_BYTES,

  async connected() {
    return true;
  },

  check({ size }) {
    if (size !== undefined && size > MAX_BYTES) return `Krakenfiles takes files up to 1 GB (this one is ${formatBytes(size)})`;
    return undefined;
  },

  async buildUpload() {
    const res = await fetch(`${endpoints.krakenfilesApi}/server/available`);
    const json = await res.json().catch(() => ({}));
    const node = json?.data?.url;
    if (!res.ok || typeof node !== 'string') {
      throw new Error(`Krakenfiles has no upload server available right now (HTTP ${res.status})`);
    }
    return {
      label: 'krakenfiles',
      kind: 'multipart',
      url: new URL('/_uploader/gallery/upload', node).href,
      field: 'files[]',
      maxBytes: MAX_BYTES,
    };
  },

  async parseResponse(status, body) {
    let json: any;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`Krakenfiles sent an unexpected answer (HTTP ${status})`);
    }
    const file = json?.files?.[0];
    if (status >= 200 && status < 300 && typeof file?.url === 'string' && !file.error) {
      return new URL(file.url, 'https://krakenfiles.com').href;
    }
    throw new Error(`Krakenfiles refused the upload (${file?.error ?? json?.message ?? `HTTP ${status}`})`);
  },
};
