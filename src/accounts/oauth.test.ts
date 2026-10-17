import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { accessToken, buildAuthUrl, parseRedirect, signIn, type OAuthProvider } from './oauth';
import { getAccount, NotConnectedError, setAccount } from './store';

const REDIRECT = 'https://naicmlgekdnneapgfjkgialddpojebgd.chromiumapp.org/';

const provider = (over: Partial<OAuthProvider> = {}): OAuthProvider => ({
  id: 'google',
  name: 'Google Drive',
  clientId: 'client-123',
  authorizeUrl: 'https://accounts.example/auth',
  params: (silent) => ({ scope: 'drive.file', prompt: silent ? 'none' : 'select_account' }),
  silentRefresh: true,
  ...over,
});

describe('buildAuthUrl', () => {
  it('asks for a token with the client id, redirect, state and scope', () => {
    const url = new URL(buildAuthUrl(provider(), REDIRECT, 'st4te', false));
    expect(url.origin + url.pathname).toBe('https://accounts.example/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-123',
      response_type: 'token',
      redirect_uri: REDIRECT,
      state: 'st4te',
      scope: 'drive.file',
      prompt: 'select_account',
    });
  });

  it('uses the silent variant for background refresh', () => {
    expect(new URL(buildAuthUrl(provider(), REDIRECT, 's', true)).searchParams.get('prompt')).toBe('none');
  });
});

describe('parseRedirect', () => {
  it('reads the token and lifetime from the fragment', () => {
    expect(parseRedirect(`${REDIRECT}#access_token=abc&token_type=Bearer&expires_in=3599&state=s1`, 's1')).toEqual({
      accessToken: 'abc',
      expiresIn: 3599,
    });
  });

  it('rejects a response with the wrong state', () => {
    expect(() => parseRedirect(`${REDIRECT}#access_token=abc&state=other`, 's1')).toThrow(/did not match/);
  });

  it('turns a refusal into a readable message', () => {
    expect(() => parseRedirect(`${REDIRECT}#error=access_denied&state=s1`, 's1')).toThrow('Sign-in was cancelled.');
    expect(() => parseRedirect(`${REDIRECT}?error=invalid_client`, 's1')).toThrow(/invalid_client/);
  });
});

describe('signIn / accessToken', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
    vi.spyOn(browser.identity, 'getRedirectURL').mockReturnValue(REDIRECT);
  });

  /** Makes the fake sign-in window answer with `token`, echoing the request's state. */
  function answerWith(token: string, expiresIn = 3600) {
    return vi.spyOn(browser.identity, 'launchWebAuthFlow').mockImplementation(async ({ url }: any) => {
      const state = new URL(url).searchParams.get('state');
      return `${REDIRECT}#access_token=${token}&expires_in=${expiresIn}&state=${state}`;
    });
  }

  it('stores the token with its expiry', async () => {
    answerWith('tok-1', 3600);
    await expect(signIn(provider())).resolves.toBe('tok-1');
    const saved = await getAccount('google');
    expect(saved?.secret).toBe('tok-1');
    expect(saved!.expiresAt! - Date.now()).toBeGreaterThan(3500_000);
  });

  it('explains when a build has no client id', async () => {
    await expect(signIn(provider({ clientId: undefined }))).rejects.toThrow(/isn't set up in this build/);
  });

  it('returns a stored token while it is valid, without any sign-in window', async () => {
    const flow = answerWith('unused');
    await setAccount('google', { secret: 'tok-ok', expiresAt: Date.now() + 3600_000 });
    await expect(accessToken(provider())).resolves.toBe('tok-ok');
    expect(flow).not.toHaveBeenCalled();
  });

  it('refreshes silently when the token is about to expire', async () => {
    const flow = answerWith('tok-new');
    await setAccount('google', { secret: 'tok-old', expiresAt: Date.now() + 30_000, label: 'me@example.com' });
    await expect(accessToken(provider())).resolves.toBe('tok-new');
    expect(flow).toHaveBeenCalledWith(expect.objectContaining({ interactive: false }));
    expect((await getAccount('google'))?.label).toBe('me@example.com');
  });

  it('asks to reconnect when silent refresh is not possible', async () => {
    await setAccount('yandex', { secret: 'old', expiresAt: Date.now() - 1 });
    const p = accessToken(provider({ id: 'yandex', name: 'Yandex.Disk', silentRefresh: false }));
    await expect(p).rejects.toBeInstanceOf(NotConnectedError);
    await expect(p).rejects.toThrow(/expired\. Reconnect/);
  });

  it('asks to connect when there is no account', async () => {
    await expect(accessToken(provider())).rejects.toThrow(/Connect Google Drive/);
  });
});
