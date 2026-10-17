import { endpoints } from './endpoints';
import type { Destination } from './types';

// API docs: https://vikingfile.com/api, checked 2026-10-17. Ask for an upload server,
// then POST the file there; an empty `user` means an anonymous upload.

export const vikingfile: Destination = {
  id: 'vikingfile',
  label: 'VikingFile',
  note: 'No account needed',

  async connected() {
    return true;
  },

  check() {
    return undefined;
  },

  async buildUpload() {
    const res = await fetch(`${endpoints.vikingfileApi}/get-server`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || typeof json?.server !== 'string') {
      throw new Error(`VikingFile has no upload server available right now (HTTP ${res.status})`);
    }
    return {
      label: 'vikingfile',
      kind: 'multipart',
      url: json.server,
      field: 'file',
      fields: { user: '' },
    };
  },

  async parseResponse(status, body) {
    let json: any;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`VikingFile sent an unexpected answer (HTTP ${status})`);
    }
    if (status >= 200 && status < 300 && typeof json?.url === 'string') return json.url;
    throw new Error(`VikingFile refused the upload (${json?.error ?? json?.message ?? `HTTP ${status}`})`);
  },
};
