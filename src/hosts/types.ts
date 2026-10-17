import type { FileInfo, UploadSpec } from '@/engine/types';

export type DestinationId =
  | 'gofile'
  | 'catbox'
  | 'buzzheavier'
  | 'vikingfile'
  | 'onefichier'
  | 'fileditch'
  | 'krakenfiles'
  | 'pixeldrain'
  | 'clicknupload'
  | 'sendnow'
  | 'dailyuploads'
  | 'hexupload'
  | 'googledrive'
  | 'yandex';

export interface Destination {
  id: DestinationId;
  label: string;
  /** A short detail shown under the checkbox, e.g. "up to 200 MB". */
  note?: string;
  maxBytes?: number;
  /** Hosts that only work with the user's own account. */
  needsAccount?: boolean;
  /** Whether that account is set up (always true for hosts without one). */
  connected(): Promise<boolean>;
  /** Returns a reason when this host can't take the file. */
  check(info: FileInfo): string | undefined;
  /** May call the host first (e.g. to open an upload session); throws with a readable message. */
  buildUpload(info: FileInfo): Promise<UploadSpec>;
  /**
   * Turns the host's answer into a share link; throws with a readable message.
   * `meta` is whatever buildUpload put on the spec, e.g. where the file was saved.
   */
  parseResponse(status: number, body: string, meta?: Record<string, string>): Promise<string>;
}
