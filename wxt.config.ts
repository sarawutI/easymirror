import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: ({ mode }) => ({
    name: 'EasyMirror',
    description: 'Mirror a file from a link to your own storage accounts.',
    permissions: ['storage', 'offscreen', 'downloads', 'webRequest', 'contextMenus', 'notifications'],
    host_permissions: [
      'https://*.gofile.io/*',
      'https://catbox.moe/*',
      // The spike build talks to the local test server in spikes/server.mjs and
      // gets every site up front, so tests never hit a permission prompt.
      ...(mode === 'spike' ? ['http://127.0.0.1/*', '<all_urls>'] : []),
    ],
    // Reading files from whatever site a link points to; asked for on first mirror.
    optional_host_permissions: mode === 'spike' ? [] : ['<all_urls>'],
  }),
  hooks: {
    // The spike control page only ships in spike builds.
    'entrypoints:resolved': (wxt, entrypoints) => {
      if (wxt.config.mode === 'spike') return;
      const i = entrypoints.findIndex((e) => e.name === 'spike');
      if (i >= 0) entrypoints.splice(i, 1);
    },
  },
});
