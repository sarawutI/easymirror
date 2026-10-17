// Messages between the extension's pages, the background and the transfer engine.
import type { FileInfo, TransferJob, UploadSpec } from '@/engine/types';

/** From the popup and other extension pages to the background. */
export type BackgroundRequest =
  | { type: 'mirror'; url: string; destinations: string[] }
  | { type: 'watch-tab'; tabId: number; pageUrl?: string; destinations: string[] }
  /** The user chose the downloaded file; the page already copied it to temp storage. */
  | { type: 'picked'; id: string; info: FileInfo }
  | { type: 'cancel-job'; id: string }
  | { type: 'retry-job'; id: string }
  /** Jobs were removed from storage; recount the toolbar badge. */
  | { type: 'jobs-changed' }
  // Test builds only: the spike runner (spikes/run-spikes.mjs) and e2e tests.
  | { type: 'start-transfer'; job: TransferJob }
  | { type: 'start-pageflow'; jobId: string; pageUrl: string; name?: string; uploads?: UploadSpec[] }
  | { type: 'simulate-startup' };

export interface BackgroundReply {
  ok: boolean;
  error?: string;
  id?: string;
}

export async function askBackground(request: BackgroundRequest): Promise<BackgroundReply> {
  const reply = (await browser.runtime.sendMessage(request)) as BackgroundReply | undefined;
  return reply ?? { ok: false, error: 'EasyMirror did not answer. Try again.' };
}

/** From the background to the engine (in Chrome, the offscreen document). */
export type EngineRequest = { target: 'offscreen'; type: 'transfer'; job: TransferJob } | { target: 'offscreen'; type: 'cancel'; id: string };
