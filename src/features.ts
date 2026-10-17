// Build-time feature switches.
//
// Google Drive and Yandex.Disk need EasyMirror registered as an app with Google and
// Yandex (docs/account-setup.md), plus Google's review before the public can sign
// in. They stay off in release builds until that's done. Turning them on also adds
// the sign-in permission and their API hosts to the manifest (see wxt.config.ts).
// Test builds (mode "spike") always include them so their code stays tested.
export const OAUTH_HOSTS_ENABLED = false;

export function oauthHostsEnabled(mode: string): boolean {
  return OAUTH_HOSTS_ENABLED || mode === 'spike';
}

// Krakenfiles is built and passes the mock tests, but on 2026-10-17 every one of its
// upload servers refused connections, so a real upload couldn't be checked. Turn it
// on once a real test upload works (see docs/host-research.md). Turning it on also
// adds its hosts to the manifest. Test builds always include it.
export const KRAKENFILES_ENABLED = false;

export function krakenfilesEnabled(mode: string): boolean {
  return KRAKENFILES_ENABLED || mode === 'spike';
}
