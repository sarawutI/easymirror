import { getAccount, NotConnectedError, type AccountId } from '@/accounts/store';
import { endpoints } from './endpoints';
import type { Destination, DestinationId } from './types';

// Hosts running XFileSharing share one API, e.g. https://clicknupload.click/api
// (checked 2026-10-17 for all four below):
//   GET  /api/account/info?key=K     -> { status: 200, result: { login?, email, premium_expire } }
//   GET  /api/upload/server?key=K    -> { status: 200, sess_id, result: <upload URL> }
//   POST <upload URL>, multipart: sess_id, utype, file_0 -> [{ file_code, file_status: "OK" }]
// The share link is <site>/<file_code>. Each user needs their own account and API key.

export interface XfsSite {
  id: DestinationId & AccountId;
  label: string;
  /** Public site address; share links and the "get your key" hint point here. */
  site: string;
}

export const XFS_SITES: XfsSite[] = [
  { id: 'clicknupload', label: 'Clicknupload', site: 'https://clicknupload.click' },
  { id: 'sendnow', label: 'Send.now', site: 'https://send.now' },
  { id: 'dailyuploads', label: 'Daily Uploads', site: 'https://dailyuploads.net' },
  { id: 'hexupload', label: 'HexUpload', site: 'https://hexload.com' },
];

interface XfsAnswer {
  status?: number;
  msg?: string;
  sess_id?: string;
  result?: any;
}

async function call(site: XfsSite, path: string, key: string): Promise<XfsAnswer> {
  const res = await fetch(`${endpoints.xfsApi(site.site)}${path}?key=${encodeURIComponent(key)}`);
  const json = (await res.json().catch(() => undefined)) as XfsAnswer | undefined;
  if (!json) throw new Error(`${site.label} sent an unexpected answer (HTTP ${res.status})`);
  if (json.status !== 200) {
    if (/invalid key/i.test(json.msg ?? '')) {
      throw new Error(`${site.label} rejected your API key. Update it in EasyMirror settings.`);
    }
    throw new Error(`${site.label} said: ${json.msg ?? `HTTP ${json.status ?? res.status}`}`);
  }
  return json;
}

/** Checks a key and returns the account's name. Used by the settings page. */
export async function verifyXfsKey(site: XfsSite, key: string): Promise<string> {
  try {
    const { result } = await call(site, '/account/info', key);
    return (result?.login as string) || (result?.email as string) || 'your account';
  } catch (e) {
    if (/rejected your API key/.test(String((e as Error).message))) {
      throw new Error(`That API key doesn't work. Copy it again from your ${site.label} account page.`);
    }
    throw e;
  }
}

export function xfsDestination(site: XfsSite): Destination {
  return {
    id: site.id,
    label: site.label,
    note: 'Your account (API key)',
    needsAccount: true,

    async connected() {
      return !!(await getAccount(site.id));
    },

    check() {
      return undefined; // limits depend on the user's plan; the host reports them
    },

    async buildUpload() {
      const account = await getAccount(site.id);
      if (!account) throw new NotConnectedError(`Add your ${site.label} API key in EasyMirror settings first.`);
      const [server, info] = await Promise.all([
        call(site, '/upload/server', account.secret),
        call(site, '/account/info', account.secret),
      ]);
      if (typeof server.result !== 'string' || !server.sess_id) {
        throw new Error(`${site.label} has no upload server available right now`);
      }
      // utype is the account type the upload counts against.
      const premium = !!info.result?.premium_expire && Date.parse(info.result.premium_expire) > Date.now();
      const utype = premium ? 'prem' : 'reg';
      // The sites' own upload forms (checked 2026-10-17) also put these in the address,
      // which makes upload.cgi answer with JSON; the API docs only show the form fields.
      const url = new URL(server.result);
      url.searchParams.set('upload_type', 'file');
      url.searchParams.set('utype', utype);
      return {
        label: site.id,
        kind: 'multipart',
        url: url.href,
        field: 'file_0',
        fields: { sess_id: server.sess_id, utype },
      };
    },

    async parseResponse(status, body) {
      let json: any;
      try {
        json = JSON.parse(body);
      } catch {
        throw new Error(`${site.label} sent an unexpected answer (HTTP ${status})`);
      }
      const file = Array.isArray(json) ? json[0] : json?.files?.[0];
      if (status >= 200 && status < 300 && file?.file_code && (file.file_status ?? 'OK') === 'OK') {
        return `${site.site}/${file.file_code}`;
      }
      throw new Error(`${site.label} refused the upload (${file?.file_status ?? json?.msg ?? `HTTP ${status}`})`);
    },
  };
}

export const xfsDestinations = XFS_SITES.map(xfsDestination);
