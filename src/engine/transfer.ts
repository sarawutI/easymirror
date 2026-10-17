import { formatBytes } from './filename';
import type { FetchSpec, UploadSpec } from './types';

/** Writes are batched to this size; awaiting a write per network chunk is slow. */
const WRITE_BATCH = 8 * 1024 * 1024;

// A connection can stop moving without ever closing; without a limit the job would sit
// at "downloading" or "uploading" forever. Test builds use seconds so tests stay quick.
const TEST = import.meta.env.MODE === 'spike';
/** No bytes moving for this long means the connection is stuck. */
const STALL_MS = TEST ? 3_000 : 3 * 60_000;
/** Once the whole file is sent, how long a host may take to answer (big files take a while to process). */
const ANSWER_MS = TEST ? 5_000 : 15 * 60_000;
const CHECK_MS = TEST ? 250 : 10_000;
const duration = (ms: number) => (ms >= 60_000 ? `${ms / 60_000} minutes` : `${ms / 1000} seconds`);
/** A dropped download carries on from where it stopped, this many times. */
const MAX_RESUMES = 3;
const RESUME_WAIT_MS = TEST ? 100 : 2_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The error a cancelled transfer ends with. */
export const CANCELLED = 'Cancelled';
const cancelled = () => new Error(CANCELLED);

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

/** Deletes every temp file. Only safe when no transfer is running (at startup). */
export async function clearTemp() {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry('jobs', { recursive: true }).catch(() => {});
}

/** Opens the source; throws on a non-2xx answer so callers can fall back. `signal` cancels it, body included. */
export async function openSource(spec: FetchSpec, signal?: AbortSignal): Promise<Response> {
  const init: RequestInit = { method: spec.method ?? 'GET', headers: spec.headers, credentials: 'include' };
  if (spec.form) {
    const body = new URLSearchParams();
    for (const [k, values] of Object.entries(spec.form)) for (const v of values) body.append(k, v);
    init.body = body;
  }
  // Only waiting for the answer is limited here; saveToTemp watches the body.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`the site didn't answer for ${duration(STALL_MS)}`)), STALL_MS);
  let res: Response;
  try {
    res = await fetch(spec.url, { ...init, signal: signal ? AbortSignal.any([ctl.signal, signal]) : ctl.signal });
  } catch (e) {
    throw signal?.aborted ? cancelled() : e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok || !res.body) throw new Error(`source answered HTTP ${res.status}`);
  return res;
}

/** One read, or an error once nothing has arrived for STALL_MS. */
async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the download stopped moving for ${duration(STALL_MS)}; the site may have dropped it. Try again.`)),
      STALL_MS,
    );
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the source for the rest of the file; undefined when it can't (or won't) send just that part. */
async function rest(reopen: (from: number) => Promise<Response>, from: number) {
  const res = await reopen(from).catch(() => undefined);
  if (!res) return undefined;
  const start = /^bytes (\d+)-/.exec(res.headers.get('content-range') ?? '')?.[1];
  if (res.status !== 206 || Number(start) !== from || !res.body) {
    await res.body?.cancel().catch(() => {});
    return undefined;
  }
  return res.body.getReader();
}

/**
 * Streams a response into a temp file in the origin-private file system. If the
 * connection drops or stalls and `reopen` is given, carries on from the last byte
 * received (when the site supports partial downloads), up to MAX_RESUMES times.
 */
export async function saveToTemp(
  res: Response,
  tempName: string,
  onProgress: (loaded: number, total?: number) => void,
  opts: { signal?: AbortSignal; reopen?: (from: number) => Promise<Response> } = {},
): Promise<File> {
  // A compressed answer's length is not the file's; don't trust it then.
  const encoded = !!res.headers.get('content-encoding');
  const total = encoded ? undefined : Number(res.headers.get('content-length')) || undefined;
  const handle = await (await jobsDir()).getFileHandle(tempName, { create: true });
  const writable = await handle.createWritable();
  let reader = res.body!.getReader();
  let loaded = 0;
  let resumes = 0;
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
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await readWithin(reader);
      } catch (e) {
        if (opts.signal?.aborted) throw cancelled();
        if (!opts.reopen || !loaded || resumes >= MAX_RESUMES) throw e;
        reader.cancel().catch(() => {});
        resumes++;
        await sleep(RESUME_WAIT_MS * resumes);
        const next = await rest(opts.reopen, loaded);
        if (!next) throw e;
        reader = next;
        continue;
      }
      if (chunk.done) break;
      batch.push(chunk.value);
      batchSize += chunk.value.byteLength;
      loaded += chunk.value.byteLength;
      if (batchSize >= WRITE_BATCH) await flush();
      // Every read, so a slow download still shows progress (the engine throttles this).
      onProgress(loaded, total);
    }
    if (total !== undefined && loaded !== total) throw new Error(`the site sent ${formatBytes(loaded)} of ${formatBytes(total)}`);
    await flush();
    await writable.close();
  } catch (e) {
    reader.cancel().catch(() => {});
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
  signal?: AbortSignal,
): Promise<Answer> {
  const host = new URL(url).host;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);

    // Two limits: STALL_MS while bytes should be moving, ANSWER_MS while the host works
    // on a file it has fully received.
    let moved = Date.now();
    let waiting = body === null;
    let gaveUp: string | undefined;
    xhr.upload.onprogress = (e) => {
      moved = Date.now();
      onProgress(e.loaded);
    };
    xhr.upload.onload = () => {
      moved = Date.now();
      waiting = true;
    };
    xhr.onreadystatechange = () => {
      moved = Date.now();
      if (xhr.readyState >= XMLHttpRequest.HEADERS_RECEIVED) waiting = false;
    };
    xhr.onprogress = () => (moved = Date.now());
    const watch = setInterval(() => {
      const quiet = Date.now() - moved;
      if (waiting && quiet > ANSWER_MS) {
        gaveUp = `${host} got the whole file but didn't answer for ${duration(ANSWER_MS)}, so EasyMirror stopped waiting. The file may still appear on the site.`;
      } else if (!waiting && quiet > STALL_MS) {
        gaveUp = `The upload to ${host} stopped moving for ${duration(STALL_MS)}, so EasyMirror gave up. Try again later.`;
      }
      if (gaveUp) xhr.abort();
    }, CHECK_MS);
    const stop = () => {
      gaveUp = CANCELLED;
      xhr.abort();
    };
    signal?.addEventListener('abort', stop, { once: true });
    xhr.onloadend = () => {
      clearInterval(watch);
      signal?.removeEventListener('abort', stop);
    };

    xhr.onload = () => resolve({ status: xhr.status, response: xhr.responseText });
    // XHR gives no detail here: refused connection, dropped connection and blocked request look alike.
    xhr.onerror = () => reject(new Error(`Couldn't reach the upload server (${host}). The site may be down; try again later.`));
    xhr.onabort = () => reject(new Error(gaveUp ?? 'upload aborted'));
    xhr.send(body);
  });
}

export function upload(file: File, spec: UploadSpec, onProgress: (sent: number) => void, signal?: AbortSignal): Promise<Answer> {
  if (spec.kind === 'chunked') return uploadChunked(file, spec, onProgress, signal);
  if (spec.kind === 'put') return request('PUT', spec.url, spec.headers, file, onProgress, signal);
  const form = new FormData();
  for (const [k, v] of Object.entries(spec.fields ?? {})) form.append(k, v);
  form.append(spec.field ?? 'file', file, file.name);
  return request('POST', spec.url, spec.headers, form, onProgress, signal);
}

const CHUNK_TRIES = 5;
/** Worth another try: no connection, rate limited, or a server error. */
const retryable = (status: number) => status === 0 || status === 429 || status >= 500;

/**
 * Sends the file in pieces, one after another, each a slice read from disk (so memory
 * stays flat), then asks the host to put them together. The finish answer goes to the
 * destination's parseResponse like a single upload's would.
 */
async function uploadChunked(file: File, spec: UploadSpec, onProgress: (sent: number) => void, signal?: AbortSignal): Promise<Answer> {
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
        ({ status, response } = await request(c.method, url, c.headers, body, (n) => onProgress(confirmed + n), signal));
      } catch (e) {
        if (signal?.aborted || attempt >= CHUNK_TRIES) throw e;
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
      if (signal?.aborted) throw cancelled();
    }
  };

  for (let i = 0; i < count; i++) await sendChunk(i);

  // A host may answer the finish call with the pieces it is still missing (HTTP 409).
  for (let round = 0; ; round++) {
    const answer = await request('POST', c.finishUrl, c.headers, null, () => {}, signal);
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
