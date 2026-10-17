// Chrome's home for the transfer engine: an offscreen document lives on while the
// service worker is stopped. It only gets browser.runtime, so events go back as messages.
import { cancelRun, runJob } from '@/engine/engine';
import type { EngineRequest } from '@/messages';

browser.runtime.onMessage.addListener((msg: EngineRequest) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'transfer') void runJob(msg.job, (event) => browser.runtime.sendMessage(event));
  if (msg.type === 'cancel') cancelRun(msg.id);
});
