import type { FileInfo, UploadSpec } from '@/engine/types';

export type DestinationId = 'gofile' | 'catbox';

export interface Destination {
  id: DestinationId;
  label: string;
  /** One line shown under the checkbox, e.g. "No account needed · up to 200 MB". */
  note: string;
  maxBytes?: number;
  /** Returns a reason when this host can't take the file. */
  check(info: FileInfo): string | undefined;
  buildUpload(info: FileInfo): Promise<UploadSpec>;
  /** Turns the host's answer into a share link; throws with a readable message. */
  parseResponse(status: number, body: string): Promise<string>;
}
