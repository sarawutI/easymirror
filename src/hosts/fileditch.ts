import { extensionOf, formatBytes } from '@/engine/filename';
import { endpoints } from './endpoints';
import type { Destination } from './types';

// FileDitch has no documented API. This follows new.fileditch.com's own uploader, as
// read from its page on 2026-10-17 (the old up1.fileditch.com endpoint is gone):
//   POST chunked.php?action=init&filename=&size= -> { success, id, chunk_size, total_chunks }
//   PUT  chunked.php?action=chunk&id=&i=N (raw bytes, one piece) -> { success }
//   POST chunked.php?action=finish&id=  -> { success, url }, or 409 { missing: [N, ...] }
// The size limit and blocked types are the page's own checks. Since the uploader isn't
// a documented API, it may change without notice.
const MAX_BYTES = 150 * 1024 ** 3;
const BLOCKED = new Set(
  (
    'php php3 php4 php5 php7 php8 phtml phar html htm xhtml xht shtml shtm stm mht mhtml hta js mjs cjs ws wsc ' +
    'sct vb pl cgi py rb sh bash zsh fish ps1 psm1 psd1 bat cmd vbs vbe jse wsf wsh xml xsl xslt svg svgz ' +
    'exe dll msi msp msu scr cpl com reg lnk scf url apk ipa xapk app deb rpm jar war ear jnlp ' +
    'docm xlsm pptm xlam xltm dotm potm ppam ppsm swf'
  ).split(' '),
);

export const fileditch: Destination = {
  id: 'fileditch',
  label: 'FileDitch',
  note: 'No account needed',
  maxBytes: MAX_BYTES,

  async connected() {
    return true;
  },

  check({ name, size }) {
    const ext = extensionOf(name);
    if (BLOCKED.has(ext)) return `FileDitch doesn't accept .${ext} files`;
    // An unknown size is fine here: uploads are opened after the download, with the real size.
    if (size === 0) return "FileDitch doesn't accept empty files";
    if (size !== undefined && size > MAX_BYTES) return `FileDitch takes files up to 150 GB (this one is ${formatBytes(size)})`;
    return undefined;
  },

  async buildUpload(info) {
    if (info.size === undefined) throw new Error('FileDitch needs the file size before uploading');
    const base = endpoints.fileditchChunked;
    const res = await fetch(`${base}?action=init&filename=${encodeURIComponent(info.name)}&size=${info.size}`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success || !json.id || !(json.chunk_size > 0)) {
      throw new Error(`FileDitch couldn't start the upload (${json?.error ?? `HTTP ${res.status}`})`);
    }
    const id = encodeURIComponent(json.id);
    return {
      label: 'fileditch',
      kind: 'chunked',
      url: base,
      maxBytes: MAX_BYTES,
      chunked: {
        chunkSize: json.chunk_size,
        chunkUrl: `${base}?action=chunk&id=${id}&i={index}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        finishUrl: `${base}?action=finish&id=${id}`,
      },
    };
  },

  async parseResponse(status, body) {
    let json: any;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`FileDitch sent an unexpected answer (HTTP ${status})`);
    }
    if (status === 200 && json?.success && typeof json.url === 'string') return json.url;
    throw new Error(`FileDitch refused the upload (${json?.error ?? `HTTP ${status}`})`);
  },
};
