/** A request the engine can replay to fetch a file. */
export interface FetchSpec {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** urlencoded form body, e.g. a host's "download" form */
  form?: Record<string, string[]>;
}

export interface UploadSpec {
  /** Destination id (or a test label); keys the job's upload state. */
  label: string;
  /** 'chunked' sends the file in pieces, then calls a finish URL (see `chunked`). */
  kind: 'put' | 'multipart' | 'chunked';
  /** Where the file goes; for 'chunked', the host's upload page (only used in messages). */
  url: string;
  /** chunked only */
  chunked?: {
    chunkSize: number;
    /** Each piece's URL; "{index}" is replaced with the 0-based piece number. */
    chunkUrl: string;
    /** Pieces are sent as the raw request body. */
    method: 'PUT' | 'POST';
    headers?: Record<string, string>;
    /** POSTed after the last piece; its answer goes to parseResponse. */
    finishUrl: string;
  };
  headers?: Record<string, string>;
  /** multipart only: form field that carries the file */
  field?: string;
  /** multipart only: extra text fields */
  fields?: Record<string, string>;
  /** Checked again after download, for sources that don't send a size up front. */
  maxBytes?: number;
  /** Destination's own notes for its parseResponse step (e.g. the saved path). */
  meta?: Record<string, string>;
}

/** What the engine learns about a file once the source answers. */
export interface FileInfo {
  name: string;
  size?: number;
  type?: string;
}

export interface TransferJob {
  id: string;
  /** Where to download from. Absent when the user picked a local file (see `picked`). */
  source?: FetchSpec;
  /** The user chose the file on disk; it is already in temp storage as `${id}.part`. */
  picked?: FileInfo;
  /** Fixed file name; otherwise taken from the source's headers or URL. */
  name?: string;
  /** Fixed uploads (spike runner); otherwise the engine asks the background once the source answers. */
  uploads?: UploadSpec[];
  /**
   * Page-flow jobs: tell the background as soon as the source answers, so it can
   * cancel (ok) or resume (failed) the browser's own paused download.
   */
  confirmSource?: boolean;
}

export type JobStatus =
  | 'queued'
  | 'waiting-for-user'
  | 'downloading'
  | 'uploading'
  | 'done'
  | 'error'
  | 'fallback-needed';

export interface UploadState {
  sent: number;
  /** Bytes per second lately, while sending. */
  rate?: number;
  done: boolean;
  status?: number;
  response?: string;
  error?: string;
  /** Why this destination was left out, e.g. "Catbox takes files up to 200 MB". */
  skipped?: string;
  link?: string;
  /** Copied from the UploadSpec at planning time, for parseResponse. */
  meta?: Record<string, string>;
}

export interface JobState {
  id: string;
  status: JobStatus;
  sourceUrl?: string;
  name?: string;
  size?: number;
  downloaded: number;
  total?: number;
  /** Download speed lately, in bytes per second. */
  rate?: number;
  uploads: Record<string, UploadState>;
  error?: string;
  peakHeapBytes?: number;
  /** Page flow: we opened the host's page, or we're watching the user's own tab. */
  pageMode?: 'opened' | 'watching';
  /** Set once the finish notification went out. */
  notified?: boolean;
  /** The user cancelled it; the engine's remaining events are ignored. */
  cancelled?: boolean;
  /** Cut off by the browser closing or EasyMirror updating. */
  interrupted?: boolean;
  startedAt: number;
  updatedAt: number;
}

/** Before the download: how many destinations would take the file. */
export interface DestinationCheck {
  accepted: number;
}

/** After the download: the uploads to send, with each host's upload already opened. */
export interface UploadPlan {
  uploads: UploadSpec[];
}

/** Messages from the transfer engine to the background. */
export type EngineEvent =
  | { target: 'background'; type: 'job-update'; id: string; patch: Partial<JobState> }
  | { target: 'background'; type: 'upload-update'; id: string; label: string; patch: UploadState }
  /** Before downloading: skip destinations that can't take the file (size, type). */
  | { target: 'background'; type: 'check-destinations'; id: string; info: FileInfo }
  /**
   * After downloading, with the exact size: open each remaining host's upload. Done
   * this late so upload sessions can't expire while a long download runs.
   */
  | { target: 'background'; type: 'prepare-uploads'; id: string; info: FileInfo }
  /** The link opened a web page; the background switches the job to the page flow. */
  | { target: 'background'; type: 'source-is-page'; id: string; url: string }
  | { target: 'background'; type: 'source-ok'; id: string }
  | { target: 'background'; type: 'source-failed'; id: string; error: string };
