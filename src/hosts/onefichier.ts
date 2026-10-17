import { formatBytes } from '@/engine/filename';
import { endpoints } from './endpoints';
import type { Destination } from './types';

// API docs: https://1fichier.com/api.html, checked 2026-10-17. Uploading is open to
// everyone without a key; only download features need Premium. Three steps:
//   1. POST /v1/upload/get_upload_server.cgi        -> { url: "up2.1fichier.com", id }
//   2. POST https://{url}/upload.cgi?id={id}, file[] -> redirect to end.pl (a web page)
//   3. GET  https://{url}/end.pl?xid={id}, "JSON: 1" -> { links: [{ download, ... }] }
const MAX_BYTES = 300 * 1024 ** 3; // "300GB maximum per file"

export const onefichier: Destination = {
  id: 'onefichier',
  label: '1Fichier',
  note: 'No account needed',
  maxBytes: MAX_BYTES,

  async connected() {
    return true;
  },

  check({ size }) {
    if (size !== undefined && size > MAX_BYTES) return `1Fichier takes files up to 300 GB (this one is ${formatBytes(size)})`;
    return undefined;
  },

  async buildUpload() {
    const res = await fetch(`${endpoints.fichierApi}/upload/get_upload_server.cgi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || typeof json?.url !== 'string' || typeof json?.id !== 'string') {
      throw new Error(`1Fichier has no upload server available right now (HTTP ${res.status})`);
    }
    const node = endpoints.fichierNode(json.url);
    return {
      label: 'onefichier',
      kind: 'multipart',
      url: `${node}/upload.cgi?id=${encodeURIComponent(json.id)}`,
      field: 'file[]',
      maxBytes: MAX_BYTES,
      meta: { node, id: json.id },
    };
  },

  // The upload's own answer is the report web page; the links come from end.pl as JSON.
  async parseResponse(status, _body, meta) {
    if (status >= 400) throw new Error(`1Fichier refused the upload (HTTP ${status})`);
    if (!meta?.node || !meta.id) throw new Error('1Fichier upload details were lost; try again');
    const res = await fetch(`${meta.node}/end.pl?xid=${encodeURIComponent(meta.id)}`, { headers: { JSON: '1' } });
    const json = await res.json().catch(() => undefined);
    const link = json?.links?.[0]?.download;
    if (res.ok && typeof link === 'string') return link;
    throw new Error(`1Fichier accepted the file but sent no link (HTTP ${res.status})`);
  },
};
