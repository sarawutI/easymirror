import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { catbox } from './catbox';
import { gofile } from './gofile';

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
