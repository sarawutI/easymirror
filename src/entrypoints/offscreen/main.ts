// Chrome's home for the transfer engine: an offscreen document lives on while the
// service worker is stopped. It only gets browser.runtime, so events go back as messages.
import { runJob } from '@/engine/engine';
import type { TransferJob } from '@/engine/types';

browser.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'transfer') void runJob(msg.job as TransferJob, (event) => browser.runtime.sendMessage(event));
});
