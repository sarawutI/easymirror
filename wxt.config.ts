import { defineConfig } from 'wxt';
import { krakenfilesEnabled, oauthHostsEnabled } from './src/features';

// Pins the extension ID (naicmlgekdnneapgfjkgialddpojebgd) for unpacked builds, so
// the Google/Yandex sign-in redirect URL stays the same. See scripts/make-extension-key.mjs.
// Only needed (and only added) when Google Drive / Yandex.Disk are switched on; the
// stores assign their own IDs anyway.
const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2G9oXRLrbElEOxpT0zN1XvJDkmvGABsypTKk3JhDgFnTL5q9QQE9b8+rVbwOlch2A3nWA86fK1OHVFWXX1frDepDdtTY5Pbk4TXpWHP+nitAn07c1ErSXcTFZ3p6Gu9G+/7Y+HdnvbfjSOLOgQtTufkfaeMY+0V6KEbER1Dg0GPzZ/VXvCyV6Lg35seJOIMqfGM8YF17yWzOfbEw6WJXA/27LFlgFngwe12e+dNskPWuMmyoy/XRLFUahk0c2/2Fx82cTN/XUS2AZvcySyCz64OlzJtPSj+GGWkLE0qhOCiRyR35NZ0mBnd9i8iRBhWdLsF1dQ/bbeXinwHSdkgu1wIDAQAB';

/** Google Drive and Yandex.Disk APIs; Yandex hands out upload URLs on its uploader hosts. */
const OAUTH_HOST_PERMISSIONS = ['https://www.googleapis.com/*', 'https://cloud-api.yandex.net/*', 'https://*.disk.yandex.net/*'];

export default defineConfig({
  srcDir: 'src',
  manifest: ({ mode, browser }) => {
    const oauth = oauthHostsEnabled(mode);
    const firefox = browser === 'firefox';
    // Reading files from whatever site a link points to; asked for on first mirror.
    // Firefox's build is Manifest V2 (see the background entrypoint), which lists it as a permission.
    const allSites = mode === 'spike' ? [] : ['<all_urls>'];
    return {
      name: 'EasyMirror',
      description: 'Mirror a file from a link to your own storage accounts.',
      ...(oauth ? { key: EXTENSION_KEY } : {}),
      permissions: [
        'storage',
        // Chrome runs the engine in an offscreen document; Firefox in the background page.
        ...(firefox ? [] : ['offscreen']),
        'downloads',
        'webRequest',
        'contextMenus',
        'notifications',
        ...(oauth ? ['identity'] : []),
      ],
      host_permissions: [
        'https://*.gofile.io/*',
        'https://catbox.moe/*',
        'https://*.buzzheavier.com/*',
        'https://*.vikingfile.com/*',
        'https://*.1fichier.com/*',
        'https://*.fileditch.com/*',
        // Krakenfiles' site, and the domain of its upload servers.
        ...(krakenfilesEnabled(mode) ? ['https://*.krakenfiles.com/*', 'https://*.krakencloud.net/*'] : []),
        'https://pixeldrain.com/*',
        // XFileSharing hosts. Their upload servers are on other, changing domains,
        // which the all-sites permission below covers (every mirror asks for it first).
        'https://*.clicknupload.click/*',
        'https://*.send.now/*',
        'https://*.dailyuploads.net/*',
        'https://*.hexload.com/*',
        ...(oauth ? OAUTH_HOST_PERMISSIONS : []),
        // The spike build talks to the local test server in spikes/server.mjs and
        // gets every site up front, so tests never hit a permission prompt.
        ...(mode === 'spike' ? ['http://127.0.0.1/*', '<all_urls>'] : []),
      ],
      ...(firefox ? { optional_permissions: allSites } : { optional_host_permissions: allSites }),
      ...(firefox && {
        browser_specific_settings: {
          gecko: {
            id: 'easymirror@sarawuti.github.io',
            // The first version with Firefox's built-in data consent (below).
            strict_min_version: '140.0',
            // The file the user picks (website content) goes to the hosts they choose, and
            // each API key or token (authentication info) to the service it belongs to.
            data_collection_permissions: { required: ['authenticationInfo', 'websiteContent'] },
          },
        },
      }),
    };
  },
  zip: {
    // The source zip Firefox reviewers get: leave out local files git ignores, and images.
    excludeSources: ['.env.local', '**/*.log', 'spikes/results.json', 'tests/e2e/*.png', 'store-assets/**'],
  },
  hooks: {
    // The spike control page only ships in spike builds.
    'entrypoints:resolved': (wxt, entrypoints) => {
      if (wxt.config.mode === 'spike') return;
      const i = entrypoints.findIndex((e) => e.name === 'spike');
      if (i >= 0) entrypoints.splice(i, 1);
    },
  },
});
