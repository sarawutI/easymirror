// OAuth sign-in through identity.launchWebAuthFlow (works in Chrome, Edge and Firefox).
// Uses the implicit flow: the token comes back in the redirect URL, so no client
// secret has to ship inside the extension.
import { getAccount, NotConnectedError, setAccount, type AccountId } from './store';

export interface OAuthProvider {
  id: Extract<AccountId, 'google' | 'yandex'>;
  name: string;
  clientId: string | undefined;
  authorizeUrl: string;
  /** Extra query parameters; `silent` is a background refresh with no UI. */
  params(silent: boolean): Record<string, string>;
  /** Can a new token be fetched without showing anything (Google: prompt=none)? */
  silentRefresh: boolean;
}

/** Refresh a little before expiry so a token doesn't lapse mid-request. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

export function redirectUrl(): string {
  return browser.identity.getRedirectURL();
}

export function buildAuthUrl(provider: OAuthProvider, redirectUri: string, state: string, silent: boolean): string {
  const url = new URL(provider.authorizeUrl);
  const params = {
    client_id: provider.clientId ?? '',
    response_type: 'token',
    redirect_uri: redirectUri,
    state,
    ...provider.params(silent),
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.href;
}

/** Reads the token from the redirect URL's fragment, checking `state`. */
export function parseRedirect(responseUrl: string, expectedState: string): { accessToken: string; expiresIn?: number } {
  const fragment = new URLSearchParams(new URL(responseUrl).hash.slice(1));
  const query = new URL(responseUrl).searchParams;
  const error = fragment.get('error') ?? query.get('error');
  if (error) {
    if (error === 'access_denied') throw new Error('Sign-in was cancelled.');
    throw new Error(`Sign-in failed (${error}).`);
  }
  if (fragment.get('state') !== expectedState) throw new Error('Sign-in failed: the response did not match the request.');
  const accessToken = fragment.get('access_token');
  if (!accessToken) throw new Error('Sign-in failed: no token came back.');
  const expiresIn = Number(fragment.get('expires_in')) || undefined;
  return { accessToken, expiresIn };
}

async function authorize(provider: OAuthProvider, interactive: boolean): Promise<string> {
  if (!provider.clientId) throw new Error(`${provider.name} sign-in isn't set up in this build (see docs/account-setup.md).`);
  const state = crypto.randomUUID();
  const responseUrl = await browser.identity.launchWebAuthFlow({
    url: buildAuthUrl(provider, redirectUrl(), state, !interactive),
    interactive,
  });
  if (!responseUrl) throw new Error('Sign-in was cancelled.');
  const { accessToken, expiresIn } = parseRedirect(responseUrl, state);
  const previous = await getAccount(provider.id);
  await setAccount(provider.id, {
    secret: accessToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    label: previous?.label,
  });
  return accessToken;
}

/** Interactive sign-in from the settings page. */
export function signIn(provider: OAuthProvider): Promise<string> {
  return authorize(provider, true);
}

/** A working access token, refreshed silently when the provider allows it. */
export async function accessToken(provider: OAuthProvider): Promise<string> {
  const account = await getAccount(provider.id);
  if (!account) throw new NotConnectedError(`Connect ${provider.name} in EasyMirror settings first.`);
  if (!account.expiresAt || account.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return account.secret;
  if (provider.silentRefresh) {
    try {
      return await authorize(provider, false);
    } catch {
      // fall through to "reconnect"
    }
  }
  throw new NotConnectedError(`Your ${provider.name} sign-in has expired. Reconnect it in EasyMirror settings.`);
}
