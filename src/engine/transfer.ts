import type { FetchSpec, UploadSpec } from './types';

/** Writes are batched to this size; awaiting a write per network chunk is slow. */
const WRITE_BATCH = 8 * 1024 * 1024;

async function jobsDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('jobs', { create: true });
}

/** A temp file written earlier, e.g. by the "choose the file" page (same extension origin). */
export async function openTemp(name: string): Promise<File> {
  return (await (await jobsDir()).getFileHandle(name)).getFile();
}

/** Copies a user-picked file into temp storage so the engine can upload it. */
export async function copyToTemp(file: File, name: string): Promise<void> {
  const handle = await (await jobsDir()).getFileHandle(name, { create: true });
  await file.stream().pipeTo(await handle.createWritable());
}

export async function removeTemp(name: string) {
  const dir = await jobsDir();
  await dir.removeEntry(name).catch(() => {});
}

/** Opens the source; throws on a non-2xx answer so callers can fall back. */
export async function openSource(spec: FetchSpec): Promise<Response> {
  const init: RequestInit = { method: spec.method ?? 'GET', headers: spec.headers, credentials: 'include' };
  if (spec.form) {
    const body = new URLSearchParams();
    for (const [k, values] of Object.entries(spec.form)) for (const v of values) body.append(k, v);
    init.body = body;
  }
  const res = await fetch(spec.url, init);
  if (!res.ok || !res.body) throw new Error(`source answered HTTP ${res.status}`);
  return res;
}

/** Streams a response into a temp file in the origin-private file system. */
export async function saveToTemp(
  res: Response,
  tempName: string,
  onProgress: (loaded: number, total?: number) => void,
): Promise<File> {
  const total = Number(res.headers.get('content-length')) || undefined;
  const handle = await (await jobsDir()).getFileHandle(tempName, { create: true });
  const writable = await handle.createWritable();
  const reader = res.body!.getReader();
  let loaded = 0;
  let batch: Uint8Array[] = [];
  let batchSize = 0;
  const flush = async () => {
    if (!batchSize) return;
    const merged = new Uint8Array(batchSize);
    let offset = 0;
    for (const part of batch) {
      merged.set(part, offset);
      offset += part.byteLength;
    }
    await writable.write(merged);
    batch = [];
    batchSize = 0;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      batch.push(value);
      batchSize += value.byteLength;
      loaded += value.byteLength;
      if (batchSize >= WRITE_BATCH) {
        await flush();
        onProgress(loaded, total);
      }
    }
    await flush();
    await writable.close();
  } catch (e) {
    await writable.abort().catch(() => {});
    throw e;
  }
  onProgress(loaded, total);
  return handle.getFile();
}

type Answer = { status: number; response: string };

/** One request. XHR rather than fetch: fetch has no upload progress. */
function request(
  method: string,
  url: string,
  headers: Record<string, string> | undefined,
  body: Blob | FormData | null,
  onProgress: (sent: number) => void,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, response: xhr.responseText });
    // XHR gives no detail here: refused connection, dropped connection and blocked request look alike.
    xhr.onerror = () => reject(new Error(`Couldn't reach the upload server (${new URL(url).host}). The site may be down; try again later.`));
    xhr.onabort = () => reject(new Error('upload aborted'));
    xhr.send(body);
  });
}

export function upload(file: File, spec: UploadSpec, onProgress: (sent: number) => void): Promise<Answer> {
  if (spec.kind === 'chunked') return uploadChunked(file, spec, onProgress);
  if (spec.kind === 'put') return request('PUT', spec.url, spec.headers, file, onProgress);
  const form = new FormData();
  for (const [k, v] of Object.entries(spec.fields ?? {})) form.append(k, v);
  form.append(spec.field ?? 'file', file, file.name);
  return request('POST', spec.url, spec.headers, form, onProgress);
}

const CHUNK_TRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Worth another try: no connection, rate limited, or a server error. */
const retryable = (status: number) => status === 0 || status === 429 || status >= 500;

/**
 * Sends the file in pieces, one after another, each a slice read from disk (so memory
 * stays flat), then asks the host to put them together. The finish answer goes to the
 * destination's parseResponse like a single upload's would.
 */
async function uploadChunked(file: File, spec: UploadSpec, onProgress: (sent: number) => void): Promise<Answer> {
  if (!spec.chunked) throw new Error(`${spec.label}: chunked upload without chunk settings`);
  const c = spec.chunked;
  const count = Math.max(1, Math.ceil(file.size / c.chunkSize));
  const chunkBytes = (i: number) => Math.min(c.chunkSize, file.size - i * c.chunkSize);
  let confirmed = 0; // bytes of pieces the host has accepted

  const sendChunk = async (i: number) => {
    const start = i * c.chunkSize;
    const url = c.chunkUrl.replace('{index}', String(i));
    for (let attempt = 1; ; attempt++) {
      let status = 0;
      let response = '';
      try {
        const body = file.slice(start, start + chunkBytes(i));
        ({ status, response } = await request(c.method, url, c.headers, body, (n) => onProgress(confirmed + n)));
      } catch (e) {
        if (attempt >= CHUNK_TRIES) throw e;
      }
      const ok = status >= 200 && status < 300;
      // Some hosts answer HTTP 200 with { success: false }: that's a final no.
      const refused = ok && /"success"\s*:\s*false/.test(response);
      if (ok && !refused) {
        confirmed += chunkBytes(i);
        return;
      }
      if (refused || !retryable(status) || attempt >= CHUNK_TRIES) {
        throw new Error(`piece ${i + 1} of ${count} was refused (HTTP ${status}${response ? `: ${response.slice(0, 200)}` : ''})`);
      }
      await sleep(Math.min(16_000, (status === 429 ? 2000 : 1000) * 2 ** (attempt - 1)));
    }
  };

  for (let i = 0; i < count; i++) await sendChunk(i);

  // A host may answer the finish call with the pieces it is still missing (HTTP 409).
  for (let round = 0; ; round++) {
    const answer = await request('POST', c.finishUrl, c.headers, null, () => {});
    let missing: number[] = [];
    try {
      missing = answer.status === 409 ? (JSON.parse(answer.response)?.missing ?? []) : [];
    } catch {
      // not JSON: hand the answer to parseResponse as it is
    }
    if (!missing.length || round >= 3) return answer;
    for (const i of missing) {
      confirmed -= chunkBytes(i);
      await sendChunk(i);
    }
  }
}
