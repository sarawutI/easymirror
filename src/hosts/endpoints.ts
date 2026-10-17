// Spike/test builds point hosts at the local mock server in spikes/server.mjs.
const TEST = import.meta.env.MODE === 'spike';
const MOCK = 'http://127.0.0.1:8787/mock';

export const endpoints = {
  gofileUpload: TEST ? `${MOCK}/gofile/uploadfile` : 'https://upload.gofile.io/uploadfile',
  catboxApi: TEST ? `${MOCK}/catbox/api.php` : 'https://catbox.moe/user/api.php',
  pixeldrainApi: TEST ? `${MOCK}/pixeldrain/api` : 'https://pixeldrain.com/api',
  googleApi: TEST ? `${MOCK}/google` : 'https://www.googleapis.com',
  yandexApi: TEST ? `${MOCK}/yandex/v1/disk` : 'https://cloud-api.yandex.net/v1/disk',
};
