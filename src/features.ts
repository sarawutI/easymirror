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
