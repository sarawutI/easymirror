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

/** XHR rather than fetch: fetch has no upload progress. */
export function upload(
  file: File,
  spec: UploadSpec,
  onProgress: (sent: number) => void,
): Promise<{ status: number; response: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(spec.kind === 'put' ? 'PUT' : 'POST', spec.url);
    for (const [k, v] of Object.entries(spec.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, response: xhr.responseText });
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.onabort = () => reject(new Error('upload aborted'));
    if (spec.kind === 'put') {
      xhr.send(file);
    } else {
      const form = new FormData();
      for (const [k, v] of Object.entries(spec.fields ?? {})) form.append(k, v);
      form.append(spec.field ?? 'file', file, file.name);
      xhr.send(form);
    }
  });
}
