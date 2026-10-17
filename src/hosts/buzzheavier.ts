import { endpoints } from './endpoints';
import type { Destination } from './types';

// Upload API: https://buzzheavier.com/developers (PUT the raw file to
// w.buzzheavier.com/{name}), checked 2026-10-17. Anonymous uploads need no account.

export const buzzheavier: Destination = {
  id: 'buzzheavier',
  label: 'Buzzheavier',
  note: 'No account needed',

  async connected() {
    return true;
  },

  check() {
    return undefined;
  },

  async buildUpload(info) {
    return {
      label: 'buzzheavier',
      kind: 'put',
      url: `${endpoints.buzzheavierUpload}/${encodeURIComponent(info.name)}`,
    };
  },

  async parseResponse(status, body) {
    let json: any;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`Buzzheavier sent an unexpected answer (HTTP ${status})`);
    }
    const id = json?.data?.id;
    if (status >= 200 && status < 300 && id) return `https://buzzheavier.com/${id}`;
    throw new Error(`Buzzheavier refused the upload (${json?.error ?? json?.message ?? `HTTP ${status}`})`);
  },
};
