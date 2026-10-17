import { redirectUrl, signIn, type OAuthProvider } from '@/accounts/oauth';
import { googleProvider, yandexProvider } from '@/accounts/providers';
import { clearAccount, getAccount, setAccount, type AccountId } from '@/accounts/store';
import { krakenfilesEnabled, oauthHostsEnabled } from '@/features';
import { DONATE } from '@/links';
import { USERHASH_KEY } from '@/hosts/catbox';
import { TOKEN_KEY as GOFILE_TOKEN_KEY, TOKEN_KIND_KEY as GOFILE_KIND_KEY } from '@/hosts/gofile';
import { googleAccountLabel, SHARE_KEY } from '@/hosts/googledrive';
import { verifyPixeldrainKey } from '@/hosts/pixeldrain';
import { verifyXfsKey, XFS_SITES, type XfsSite } from '@/hosts/xfilesharing';
import { yandexAccountLabel } from '@/hosts/yandex';

const hostsBox = document.getElementById('hosts')!;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c) el.append(c);
  return el;
}

const local = async <T>(key: string) => (await browser.storage.local.get(key))[key] as T | undefined;
const message = (e: unknown) => String((e as Error)?.message ?? e);

function card(id: string, title: string, state: { text: string; ok?: boolean }, ...body: (Node | false | undefined)[]) {
  return h(
    'section',
    { className: 'host', id: `host-${id}` },
    h('div', { className: 'host-head' }, h('h2', { textContent: title }), h('span', { className: `state${state.ok ? ' ok' : ''}`, textContent: state.text })),
    ...body,
  );
}

function statusLine() {
  return h('p', { className: 'hint', role: 'status' });
}

/** A text field with Save (and Remove when something is saved). */
function secretRow(opts: {
  label: string;
  placeholder: string;
  saved: boolean;
  onSave(value: string): Promise<void>;
  onRemove(): Promise<void>;
  status: HTMLElement;
}) {
  const input = h('input', { type: 'password', placeholder: opts.placeholder, autocomplete: 'off' });
  input.setAttribute('aria-label', opts.label);
  const save = h('button', { type: 'button', className: 'primary', textContent: 'Save' });
  save.addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) return void (opts.status.textContent = 'Paste it first.');
    save.disabled = true;
    opts.status.textContent = 'Checking…';
    try {
      await opts.onSave(value);
      opts.status.textContent = 'Saved.';
      input.value = '';
    } catch (e) {
      opts.status.textContent = message(e);
    } finally {
      save.disabled = false;
    }
  });
  const remove = opts.saved && h('button', { type: 'button', className: 'plain', textContent: 'Remove' });
  if (remove) remove.addEventListener('click', () => void opts.onRemove());
  return h('div', { className: 'row' }, input, save, remove);
}

async function gofileCard() {
  const kind = await local<string>(GOFILE_KIND_KEY);
  const token = await local<string>(GOFILE_TOKEN_KEY);
  const status = statusLine();
  return card(
    'gofile',
    'GoFile',
    token ? { text: kind === 'user' ? 'Your account' : 'Guest account', ok: true } : { text: 'No account needed' },
    h('p', {
      className: 'hint',
      textContent:
        kind === 'user'
          ? 'Mirrors go to your own GoFile account.'
          : 'Works without an account: EasyMirror uses one anonymous guest account for all your mirrors. To use your own account instead, paste its API token from your GoFile profile page.',
    }),
    secretRow({
      label: 'GoFile API token',
      placeholder: 'GoFile API token (optional)',
      saved: kind === 'user',
      status,
      onSave: async (value) => void (await browser.storage.local.set({ [GOFILE_TOKEN_KEY]: value, [GOFILE_KIND_KEY]: 'user' })),
      // Back to a fresh guest account on the next upload.
      onRemove: () => browser.storage.local.remove([GOFILE_TOKEN_KEY, GOFILE_KIND_KEY]),
    }),
    status,
  );
}

async function catboxCard() {
  const userhash = await local<string>(USERHASH_KEY);
  const status = statusLine();
  return card(
    'catbox',
    'Catbox',
    userhash ? { text: 'Your account', ok: true } : { text: 'No account needed' },
    h('p', {
      className: 'hint',
      textContent: userhash
        ? 'Uploads are linked to your Catbox account and kept permanently.'
        : 'Anonymous uploads are deleted after 2 years without views. Add your Catbox userhash (from your account page) to keep them permanently.',
    }),
    secretRow({
      label: 'Catbox userhash',
      placeholder: 'Catbox userhash (optional)',
      saved: !!userhash,
      status,
      onSave: async (value) => void (await browser.storage.local.set({ [USERHASH_KEY]: value })),
      onRemove: () => browser.storage.local.remove(USERHASH_KEY),
    }),
    status,
  );
}

async function pixeldrainCard() {
  const account = await getAccount('pixeldrain');
  const status = statusLine();
  return card(
    'pixeldrain',
    'Pixeldrain',
    account ? { text: `Connected as ${account.label}`, ok: true } : { text: 'Not connected' },
    h(
      'p',
      { className: 'hint' },
      'Pixeldrain needs an API key. Create one at ',
      h('a', { href: 'https://pixeldrain.com/user/api_keys', target: '_blank', rel: 'noopener', textContent: 'pixeldrain.com/user/api_keys' }),
      ' and paste it here.',
    ),
    secretRow({
      label: 'Pixeldrain API key',
      placeholder: account ? 'Replace API key' : 'Pixeldrain API key',
      saved: !!account,
      status,
      onSave: async (key) => {
        const username = await verifyPixeldrainKey(key);
        await setAccount('pixeldrain', { secret: key, label: username });
      },
      onRemove: () => clearAccount('pixeldrain'),
    }),
    status,
  );
}

/** Hosts with nothing to configure, in one card. */
function noSetupCard() {
  const kraken = krakenfilesEnabled(import.meta.env.MODE);
  const names = ['Buzzheavier', 'VikingFile', '1Fichier', 'FileDitch', ...(kraken ? ['Krakenfiles'] : [])];
  return card(
    'nosetup',
    names.join(', '),
    { text: 'No account needed' },
    h('p', {
      className: 'hint',
      textContent:
        'These work straight away, with nothing to set up. 1Fichier takes files up to 300 GB, FileDitch up to 150 GB' +
        (kraken ? ', Krakenfiles up to 1 GB.' : '.'),
    }),
    h('p', {
      className: 'hint',
      textContent: "Files uploaded without an account may be deleted after a while, following each site's own rules.",
    }),
  );
}

async function xfsCard(site: XfsSite) {
  const account = await getAccount(site.id);
  const status = statusLine();
  const domain = new URL(site.site).hostname;
  return card(
    site.id,
    site.label,
    account ? { text: `Connected as ${account.label}`, ok: true } : { text: 'Not connected' },
    h(
      'p',
      { className: 'hint' },
      `${site.label} needs a free account and its API key. Sign in at `,
      h('a', { href: site.site, target: '_blank', rel: 'noopener', textContent: domain }),
      ', copy the API key from your account settings, and paste it here.',
    ),
    secretRow({
      label: `${site.label} API key`,
      placeholder: account ? 'Replace API key' : `${site.label} API key`,
      saved: !!account,
      status,
      onSave: async (key) => {
        const name = await verifyXfsKey(site, key);
        await setAccount(site.id, { secret: key, label: name });
      },
      onRemove: () => clearAccount(site.id),
    }),
    status,
  );
}

async function oauthCard(opts: {
  id: string;
  title: string;
  provider: OAuthProvider;
  accountId: AccountId;
  about: string;
  label(token: string): Promise<string>;
  extra?: Node;
}) {
  const account = await getAccount(opts.accountId);
  const status = statusLine();
  const configured = !!opts.provider.clientId;
  const connect = h('button', {
    type: 'button',
    className: account ? 'plain' : 'primary',
    textContent: account ? 'Reconnect' : 'Connect',
    disabled: !configured,
  });
  connect.addEventListener('click', async () => {
    connect.disabled = true;
    status.textContent = 'Waiting for sign-in…';
    try {
      const token = await signIn(opts.provider);
      const label = await opts.label(token).catch(() => 'your account');
      const saved = await getAccount(opts.accountId);
      if (saved) await setAccount(opts.accountId, { ...saved, label });
      status.textContent = '';
    } catch (e) {
      status.textContent = message(e);
    } finally {
      connect.disabled = false;
    }
  });
  const disconnect = account && h('button', { type: 'button', className: 'plain', textContent: 'Disconnect' });
  if (disconnect) disconnect.addEventListener('click', () => void clearAccount(opts.accountId));
  return card(
    opts.id,
    opts.title,
    account ? { text: `Connected as ${account.label ?? 'your account'}`, ok: true } : { text: 'Not connected' },
    h('p', { className: 'hint', textContent: opts.about }),
    !configured &&
      h('p', {
        className: 'hint',
        textContent: `${opts.title} sign-in needs a one-time developer setup before it can be used (see docs/account-setup.md).`,
      }),
    h('div', { className: 'row' }, connect, disconnect),
    opts.extra,
    status,
  );
}

async function googleCard() {
  const share = (await local<boolean>(SHARE_KEY)) !== false;
  const box = h('input', { type: 'checkbox', checked: share });
  box.addEventListener('change', () => void browser.storage.local.set({ [SHARE_KEY]: box.checked }));
  return oauthCard({
    id: 'googledrive',
    title: 'Google Drive',
    provider: googleProvider,
    accountId: 'google',
    about: 'Files go to an "EasyMirror" folder in your Drive. EasyMirror can only see files it created, nothing else in your Drive.',
    label: googleAccountLabel,
    extra: h('label', { className: 'check' }, box, 'Anyone with the link can view mirrored files'),
  });
}

function yandexCard() {
  return oauthCard({
    id: 'yandex',
    title: 'Yandex.Disk',
    provider: yandexProvider,
    accountId: 'yandex',
    about:
      "Files go to EasyMirror's own folder under Applications on your Disk, and get a public link. EasyMirror can't see the rest of your Disk.",
    label: yandexAccountLabel,
  });
}

if (DONATE) {
  const donate = document.getElementById('donate-link') as HTMLAnchorElement;
  donate.href = DONATE;
  donate.hidden = false;
}

const OAUTH = oauthHostsEnabled(import.meta.env.MODE);
// Sign-in details only matter when Google Drive / Yandex.Disk are in the build.
document.querySelector<HTMLElement>('details.dev')!.hidden = !OAUTH;
// identity.getRedirectURL only exists when the build has the sign-in permission.
if (OAUTH) document.getElementById('redirect-url')!.textContent = redirectUrl();

async function render() {
  const cards = await Promise.all([
    gofileCard(),
    catboxCard(),
    noSetupCard(),
    pixeldrainCard(),
    ...XFS_SITES.map(xfsCard),
    ...(OAUTH ? [googleCard(), yandexCard()] : []),
  ]);
  hostsBox.replaceChildren(...cards);
}

const WATCHED = /^(accounts\.|hosts\.)/;
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => WATCHED.test(k))) void render();
});

void render();
