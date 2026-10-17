// Spike/test builds point hosts at the local mock server in spikes/server.mjs.
const TEST = import.meta.env.MODE === 'spike';
const MOCK = 'http://127.0.0.1:8787/mock';

export const endpoints = {
  gofileUpload: TEST ? `${MOCK}/gofile/uploadfile` : 'https://upload.gofile.io/uploadfile',
  catboxApi: TEST ? `${MOCK}/catbox/api.php` : 'https://catbox.moe/user/api.php',
  buzzheavierUpload: TEST ? `${MOCK}/buzzheavier` : 'https://w.buzzheavier.com',
  vikingfileApi: TEST ? `${MOCK}/vikingfile/api` : 'https://vikingfile.com/api',
  krakenfilesApi: TEST ? `${MOCK}/krakenfiles/api` : 'https://krakenfiles.com/api',
  pixeldrainApi: TEST ? `${MOCK}/pixeldrain/api` : 'https://pixeldrain.com/api',
  /** XFileSharing hosts: `${xfsApi(site)}/upload/server`, `/account/info`. */
  xfsApi: (site: string) => (TEST ? `${MOCK}/xfs/${new URL(site).hostname}/api` : `${site}/api`),
  googleApi: TEST ? `${MOCK}/google` : 'https://www.googleapis.com',
  yandexApi: TEST ? `${MOCK}/yandex/v1/disk` : 'https://cloud-api.yandex.net/v1/disk',
};
