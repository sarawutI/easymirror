import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { buzzheavier } from './buzzheavier';
import { catbox } from './catbox';
import { fileditch } from './fileditch';
import { gofile } from './gofile';
import { krakenfiles } from './krakenfiles';
import { onefichier } from './onefichier';
import { pixeldrain } from './pixeldrain';
import { vikingfile } from './vikingfile';
import { verifyXfsKey, XFS_SITES, xfsDestination } from './xfilesharing';
import { numberedName } from './yandex';

/** Answers fetch() calls by URL substring, in the order given. */
function stubFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const hit = Object.entries(routes).find(([part]) => url.includes(part));
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const MB = 1024 * 1024;

describe('catbox', () => {
  it('accepts ordinary files up to 200 MB', () => {
    expect(catbox.check({ name: 'clip.mp4', size: 200 * MB })).toBeUndefined();
    expect(catbox.check({ name: 'clip.mp4' })).toBeUndefined();
  });

  it('rejects files over 200 MB with a readable reason', () => {
    expect(catbox.check({ name: 'big.zip', size: 201 * MB })).toMatch(/up to 200 MB/);
  });

  it('rejects the file types Catbox bans', () => {
    for (const name of ['setup.exe', 'x.scr', 'x.cpl', 'app.jar', 'letter.doc', 'letter.docx', 'macro.docm']) {
      expect(catbox.check({ name, size: 1 }), name).toMatch(/doesn't accept/);
    }
  });

  it('caps GIFs at 20 MB', () => {
    expect(catbox.check({ name: 'a.gif', size: 21 * MB })).toMatch(/GIFs up to 20 MB/);
    expect(catbox.check({ name: 'a.gif', size: 19 * MB })).toBeUndefined();
  });

  it('builds a fileupload request', async () => {
    const spec = await catbox.buildUpload({ name: 'a.png' });
    expect(spec).toMatchObject({ kind: 'multipart', field: 'fileToUpload', fields: { reqtype: 'fileupload' } });
  });

  it('returns the link from the response body', async () => {
    await expect(catbox.parseResponse(200, 'https://files.catbox.moe/abc123.png\n')).resolves.toBe(
      'https://files.catbox.moe/abc123.png',
    );
  });

  it('turns an error body into a readable error', async () => {
    await expect(catbox.parseResponse(412, 'File too large')).rejects.toThrow(/Catbox refused the upload: File too large/);
  });
});

describe('gofile', () => {
  beforeEach(() => fakeBrowser.reset());

  const ok = (extra: object = {}) =>
    JSON.stringify({ status: 'ok', data: { downloadPage: 'https://gofile.io/d/x7k2p9Qm', ...extra } });

  it('uploads without a token the first time', async () => {
    const spec = await gofile.buildUpload({ name: 'a.bin' });
    expect(spec).toMatchObject({ kind: 'multipart', field: 'file' });
    expect(spec.headers).toBeUndefined();
    expect(spec.fields?.folderId).toBeUndefined();
  });

  it('keeps the guest token and sends it on later uploads', async () => {
    await expect(gofile.parseResponse(200, ok({ guestToken: 'guest-123' }))).resolves.toBe('https://gofile.io/d/x7k2p9Qm');
    const spec = await gofile.buildUpload({ name: 'b.bin' });
    expect(spec.headers).toEqual({ Authorization: 'Bearer guest-123' });
  });

  it('does not replace a saved token with a new guest token', async () => {
    await gofile.parseResponse(200, ok({ guestToken: 'first' }));
    await gofile.parseResponse(200, ok({ guestToken: 'second' }));
    expect((await gofile.buildUpload({ name: 'c.bin' })).headers).toEqual({ Authorization: 'Bearer first' });
  });

  it('treats an error status as a failure even with HTTP 200', async () => {
    await expect(gofile.parseResponse(200, JSON.stringify({ status: 'error-rateLimit' }))).rejects.toThrow(/rate-limiting/);
    await expect(gofile.parseResponse(403, JSON.stringify({ status: 'error-limits' }))).rejects.toThrow(/account is full/);
  });

  it('rejects a non-JSON answer', async () => {
    await expect(gofile.parseResponse(502, '<html>Bad gateway</html>')).rejects.toThrow(/unexpected answer \(HTTP 502\)/);
  });
});

describe('pixeldrain', () => {
  beforeEach(() => fakeBrowser.reset());

  it('asks for the API key when none is saved', async () => {
    await expect(pixeldrain.buildUpload({ name: 'a.bin' })).rejects.toThrow(/Add your Pixeldrain API key/);
  });

  it('PUTs the file with the key as the Basic-auth password', async () => {
    await browser.storage.local.set({ 'accounts.pixeldrain': { secret: 'k3y' } });
    const spec = await pixeldrain.buildUpload({ name: 'my file.txt' });
    expect(spec).toMatchObject({ kind: 'put', headers: { Authorization: `Basic ${btoa(':k3y')}` } });
    expect(spec.url).toMatch(/\/file\/my%20file\.txt$/);
  });

  it('builds the share link from the id', async () => {
    await expect(pixeldrain.parseResponse(201, JSON.stringify({ success: true, id: 'abc' }))).resolves.toBe('https://pixeldrain.com/u/abc');
  });

  it('maps error codes to readable messages', async () => {
    const err = (value: string, status = 400) => pixeldrain.parseResponse(status, JSON.stringify({ success: false, value }));
    await expect(err('user_out_of_space')).rejects.toThrow('Your Pixeldrain storage is full');
    await expect(err('file_too_large', 413)).rejects.toThrow('Too big for your Pixeldrain plan');
    await expect(err('email_address_not_verified', 403)).rejects.toThrow(/Verify your email/);
    await expect(err('something_new')).rejects.toThrow(/something_new/);
  });
});

describe('buzzheavier', () => {
  it('PUTs the file under its name', async () => {
    const spec = await buzzheavier.buildUpload({ name: 'my file.zip' });
    expect(spec).toMatchObject({ kind: 'put' });
    expect(spec.url).toMatch(/\/my%20file\.zip$/);
  });

  it('builds the share link from the id', async () => {
    await expect(buzzheavier.parseResponse(201, JSON.stringify({ code: 201, data: { id: 'x1y2' } }))).resolves.toBe(
      'https://buzzheavier.com/x1y2',
    );
  });

  it('turns errors into readable messages', async () => {
    await expect(buzzheavier.parseResponse(400, JSON.stringify({ error: 'bad name' }))).rejects.toThrow(/refused the upload \(bad name\)/);
    await expect(buzzheavier.parseResponse(502, '<html>')).rejects.toThrow(/unexpected answer \(HTTP 502\)/);
  });
});

describe('vikingfile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploads anonymously to the server it is given', async () => {
    stubFetch({ '/get-server': { server: 'https://cd.vikingfile.com/index.php' } });
    const spec = await vikingfile.buildUpload({ name: 'a.bin' });
    expect(spec).toMatchObject({ kind: 'multipart', url: 'https://cd.vikingfile.com/index.php', field: 'file', fields: { user: '' } });
  });

  it('explains when no upload server is available', async () => {
    stubFetch({});
    await expect(vikingfile.buildUpload({ name: 'a.bin' })).rejects.toThrow(/no upload server available/);
  });

  it('returns the link from the answer', async () => {
    const body = JSON.stringify({ name: 'a.bin', size: 1, hash: 'TPRS', url: 'https://vikingfile.com/f/TPRS' });
    await expect(vikingfile.parseResponse(200, body)).resolves.toBe('https://vikingfile.com/f/TPRS');
  });
});

describe('1fichier', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('caps files at 300 GB', () => {
    expect(onefichier.check({ name: 'a.bin', size: 300 * 1024 ** 3 })).toBeUndefined();
    expect(onefichier.check({ name: 'a.bin', size: 301 * 1024 ** 3 })).toMatch(/up to 300 GB/);
  });

  it('uploads file[] to the node it is given, remembering the upload id', async () => {
    stubFetch({ '/get_upload_server.cgi': { url: 'up2.1fichier.com', id: 'qvHUyGyOoG' } });
    const spec = await onefichier.buildUpload({ name: 'a.bin' });
    expect(spec).toMatchObject({
      kind: 'multipart',
      url: 'https://up2.1fichier.com/upload.cgi?id=qvHUyGyOoG',
      field: 'file[]',
      meta: { node: 'https://up2.1fichier.com', id: 'qvHUyGyOoG' },
    });
  });

  it('asks end.pl for the links as JSON', async () => {
    const fetchMock = stubFetch({ '/end.pl': { links: [{ download: 'https://1fichier.com/?abcef' }] } });
    const meta = { node: 'https://up2.1fichier.com', id: 'X1' };
    await expect(onefichier.parseResponse(200, '<html>report</html>', meta)).resolves.toBe('https://1fichier.com/?abcef');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://up2.1fichier.com/end.pl?xid=X1');
    expect(init.headers).toEqual({ JSON: '1' });
  });

  it('reports a refused upload without asking for links', async () => {
    const fetchMock = stubFetch({});
    await expect(onefichier.parseResponse(403, '<p>Forbidden', { node: 'n', id: 'i' })).rejects.toThrow(/refused the upload \(HTTP 403\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fileditch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("skips what FileDitch's own page rejects", () => {
    expect(fileditch.check({ name: 'setup.exe', size: 5 })).toMatch(/doesn't accept \.exe/);
    expect(fileditch.check({ name: 'page.html', size: 5 })).toMatch(/doesn't accept \.html/);
    expect(fileditch.check({ name: 'empty.txt', size: 0 })).toMatch(/empty files/);
    expect(fileditch.check({ name: 'huge.bin', size: 151 * 1024 ** 3 })).toMatch(/up to 150 GB/);
    expect(fileditch.check({ name: 'clip.mp4', size: 5 })).toBeUndefined();
  });

  it('needs the size up front', () => {
    expect(fileditch.check({ name: 'clip.mp4' })).toMatch(/needs the file size/);
  });

  it('starts an upload and describes its pieces', async () => {
    const fetchMock = stubFetch({ 'action=init': { success: true, id: 'u1', chunk_size: 52428800, total_chunks: 3 } });
    const spec = await fileditch.buildUpload({ name: 'my clip.mp4', size: 120 * MB });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://new.fileditch.com/chunked.php?action=init&filename=my%20clip.mp4&size=125829120');
    expect(spec).toMatchObject({
      kind: 'chunked',
      chunked: {
        chunkSize: 52428800,
        method: 'PUT',
        chunkUrl: 'https://new.fileditch.com/chunked.php?action=chunk&id=u1&i={index}',
        finishUrl: 'https://new.fileditch.com/chunked.php?action=finish&id=u1',
      },
    });
  });

  it('explains when the upload cannot start', async () => {
    stubFetch({ 'action=init': { success: false, error: 'uploads paused' } });
    await expect(fileditch.buildUpload({ name: 'a.zip', size: 10 })).rejects.toThrow(/couldn't start the upload \(uploads paused\)/);
  });

  it('returns the link from the finish answer', async () => {
    const ok = JSON.stringify({ success: true, url: 'https://fileditch.com/f/ab12/a.zip' });
    await expect(fileditch.parseResponse(200, ok)).resolves.toBe('https://fileditch.com/f/ab12/a.zip');
    const incomplete = JSON.stringify({ success: false, error: 'incomplete', missing: [2] });
    await expect(fileditch.parseResponse(409, incomplete)).rejects.toThrow(/refused the upload \(incomplete\)/);
  });
});

describe('krakenfiles', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('caps files at 1 GB', () => {
    expect(krakenfiles.check({ name: 'a.bin', size: 1024 * MB })).toBeUndefined();
    expect(krakenfiles.check({ name: 'a.bin', size: 1025 * MB })).toMatch(/up to 1 GB/);
  });

  it("uploads to the node's web uploader", async () => {
    stubFetch({ '/server/available': { status: 200, data: { url: 'https://hs12.krakencloud.net/api/file', serverAccessToken: 't' } } });
    const spec = await krakenfiles.buildUpload({ name: 'a.bin' });
    expect(spec).toMatchObject({ kind: 'multipart', url: 'https://hs12.krakencloud.net/_uploader/gallery/upload', field: 'files[]' });
  });

  it('turns the relative link into a full one, and reports per-file errors', async () => {
    const ok = JSON.stringify({ files: [{ url: '/view/abc/file.html' }] });
    await expect(krakenfiles.parseResponse(200, ok)).resolves.toBe('https://krakenfiles.com/view/abc/file.html');
    const bad = JSON.stringify({ files: [{ error: 'File type not allowed' }] });
    await expect(krakenfiles.parseResponse(200, bad)).rejects.toThrow(/File type not allowed/);
  });
});

describe('XFileSharing hosts', () => {
  const site = XFS_SITES.find((s) => s.id === 'clicknupload')!;
  const dest = xfsDestination(site);
  beforeEach(() => fakeBrowser.reset());
  afterEach(() => vi.unstubAllGlobals());

  it('covers Clicknupload, Send.now, Daily Uploads and HexUpload', () => {
    expect(XFS_SITES.map((s) => s.label)).toEqual(['Clicknupload', 'Send.now', 'Daily Uploads', 'HexUpload']);
  });

  it('asks for the API key when none is saved', async () => {
    await expect(dest.buildUpload({ name: 'a.bin' })).rejects.toThrow(/Add your Clicknupload API key/);
  });

  it('opens an upload session with the key and sends the file as file_0', async () => {
    await browser.storage.local.set({ 'accounts.clicknupload': { secret: 'k3y' } });
    const fetchMock = stubFetch({
      '/upload/server': { status: 200, sess_id: 'S1', result: 'https://s1.clicknupload.net/cgi-bin/upload.cgi' },
      '/account/info': { status: 200, result: { email: 'me@example.com', premium_expire: null } },
    });
    const spec = await dest.buildUpload({ name: 'a.bin' });
    expect(spec).toMatchObject({
      kind: 'multipart',
      url: 'https://s1.clicknupload.net/cgi-bin/upload.cgi',
      field: 'file_0',
      fields: { sess_id: 'S1', utype: 'reg' },
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('https://clicknupload.click/api/upload/server?key=k3y');
  });

  it('uploads as premium while the account has premium', async () => {
    await browser.storage.local.set({ 'accounts.clicknupload': { secret: 'k3y' } });
    stubFetch({
      '/upload/server': { status: 200, sess_id: 'S1', result: 'https://s1.example/upload.cgi' },
      '/account/info': { status: 200, result: { premium_expire: '2099-01-01 00:00:00' } },
    });
    expect((await dest.buildUpload({ name: 'a.bin' })).fields?.utype).toBe('prem');
  });

  it('explains a rejected key, on upload and in settings', async () => {
    await browser.storage.local.set({ 'accounts.clicknupload': { secret: 'old' } });
    stubFetch({ '/api/': { status: 400, msg: 'Invalid key' } });
    await expect(dest.buildUpload({ name: 'a.bin' })).rejects.toThrow('Clicknupload rejected your API key. Update it in EasyMirror settings.');
    await expect(verifyXfsKey(site, 'old')).rejects.toThrow(/doesn't work\. Copy it again from your Clicknupload account page/);
  });

  it('names the account from its login or email', async () => {
    stubFetch({ '/account/info': { status: 200, result: { email: 'me@example.com' } } });
    await expect(verifyXfsKey(site, 'k')).resolves.toBe('me@example.com');
  });

  it('builds the share link from the file code', async () => {
    await expect(dest.parseResponse(200, JSON.stringify([{ file_code: 'b578rni0e1ka', file_status: 'OK' }]))).resolves.toBe(
      'https://clicknupload.click/b578rni0e1ka',
    );
    await expect(dest.parseResponse(200, JSON.stringify([{ file_code: '', file_status: 'not allowed extension' }]))).rejects.toThrow(
      /refused the upload \(not allowed extension\)/,
    );
  });
});

describe('yandex numberedName', () => {
  it('numbers before the extension', () => {
    expect(numberedName('clip.mp4', 0)).toBe('clip.mp4');
    expect(numberedName('clip.mp4', 2)).toBe('clip (2).mp4');
    expect(numberedName('README', 1)).toBe('README (1)');
    expect(numberedName('archive.tar.gz', 1)).toBe('archive.tar (1).gz');
  });
});
