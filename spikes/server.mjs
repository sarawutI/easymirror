// Local test server for the M0 spikes.
//   GET  /file?size=N&name=x           deterministic file of N bytes
//   PUT  /upload/put/:name              raw-body upload (like Pixeldrain)
//   POST /upload/multipart/:name        multipart upload (like GoFile/Catbox)
//   GET  /stats                         sha256 + size of everything served/received
//   GET  /host/page?variant=..&size=..&name=..   fake file host: cookie, countdown, button
//        variants: link-multi | link-single | form-post | js-download | blob
//   GET  /file/:name?size=N[&chunked=1]  same, named by path, optionally without Content-Length
//   GET  /page.html, /missing             a web page and a 404, for error handling
//   POST /mock/gofile/uploadfile         GoFile upload API stand-in
//   POST /mock/catbox/api.php            Catbox API stand-in (rejects names containing "reject")
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import Busboy from 'busboy';

const PORT = Number(process.env.PORT ?? 8787);
const BLOCK = 1024 * 1024;
// Fixed pseudo-random block repeated to the requested size; content is
// deterministic so served and received hashes can be compared.
const block = Buffer.alloc(BLOCK);
for (let i = 0, seed = createHash('sha256').update('easymirror').digest(); i < BLOCK; i += 32) {
  seed = createHash('sha256').update(seed).digest();
  seed.copy(block, i);
}

const served = {}; // name -> { bytes, sha256 }
const received = {}; // `${kind}:${name}` -> { bytes, sha256 }
const sessions = new Set();
const tokens = new Map(); // token -> { sess, single, used, size, name }

function streamFile(res, size, name, extraHeaders = {}, { chunked = false } = {}) {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    ...(chunked ? {} : { 'Content-Length': size }),
    ...extraHeaders,
  });
  const hash = createHash('sha256');
  let sent = 0;
  const pump = () => {
    while (sent < size) {
      const n = Math.min(BLOCK, size - sent);
      const chunk = n === BLOCK ? block : block.subarray(0, n);
      hash.update(chunk);
      sent += n;
      if (!res.write(chunk)) return res.once('drain', pump);
    }
    served[name] = { bytes: sent, sha256: hash.digest('hex') };
    res.end();
  };
  res.on('close', () => {
    if (sent < size && !served[name]) served[`${name}#aborted`] = { bytes: sent };
  });
  pump();
}

const gofileAuth = []; // Authorization header of each GoFile upload, in order

/** Hashes one multipart file field; calls done(file, fields) when the body is read. */
function receiveMultipart(req, fileField, done) {
  const bb = Busboy({ headers: req.headers, limits: { fileSize: Infinity } });
  const fields = {};
  let file;
  bb.on('field', (name, value) => (fields[name] = value));
  bb.on('file', (field, stream, info) => {
    if (field !== fileField) return stream.resume();
    const hash = createHash('sha256');
    let bytes = 0;
    stream.on('data', (c) => { hash.update(c); bytes += c.length; });
    stream.on('end', () => (file = { bytes, sha256: hash.digest('hex'), filename: info.filename }));
  });
  bb.on('close', () => done(file ?? { bytes: 0, filename: '' }, fields));
  req.pipe(bb);
}

// --- Account-based host stand-ins ---------------------------------------------
// Accepted credentials: Pixeldrain key "test-key", Google/Yandex token "test-token".
const json = (res, status, body, headers = {}) =>
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));
const hosts = { driveShared: [], driveFolders: [], yandexFiles: new Set(), yandexPublished: [] };

/** Hashes a raw request body into received[key]; then calls done(). */
function receiveRaw(req, key, done) {
  const hash = createHash('sha256');
  let bytes = 0;
  req.on('data', (c) => { hash.update(c); bytes += c.length; });
  req.on('end', () => {
    received[key] = { bytes, sha256: hash.digest('hex') };
    done();
  });
}

function mockPixeldrain(req, res, p) {
  const auth = req.headers.authorization ?? '';
  const ok = auth === `Basic ${Buffer.from(':test-key').toString('base64')}`;
  if (!ok) return json(res, 401, { success: false, value: 'authentication_failed', message: 'Invalid API key' });
  if (req.method === 'GET' && p === '/mock/pixeldrain/api/user') return json(res, 200, { username: 'tester' });
  if (req.method === 'PUT' && p.startsWith('/mock/pixeldrain/api/file/')) {
    const name = decodeURIComponent(p.slice('/mock/pixeldrain/api/file/'.length));
    return receiveRaw(req, `pixeldrain:${name}`, () => json(res, 201, { success: true, id: randomBytes(4).toString('hex'), name }));
  }
  json(res, 404, { success: false, value: 'not_found' });
}

function mockGoogle(req, res, p, url) {
  const authed = req.headers.authorization === 'Bearer test-token';
  if (!authed) return json(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
  const readBody = (cb) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => cb(b ? JSON.parse(b) : {}));
  };
  if (req.method === 'GET' && p === '/mock/google/drive/v3/about') return json(res, 200, { user: { emailAddress: 'tester@example.com' } });
  if (req.method === 'GET' && p === '/mock/google/drive/v3/files') return json(res, 200, { files: hosts.driveFolders.map((id) => ({ id })) });
  if (req.method === 'POST' && p === '/mock/google/drive/v3/files') {
    return readBody(() => {
      const id = `folder-${hosts.driveFolders.length + 1}`;
      hosts.driveFolders.push(id);
      json(res, 200, { id });
    });
  }
  if (req.method === 'POST' && p === '/mock/google/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'resumable') {
    return readBody((meta) => {
      if (!hosts.driveFolders.includes(meta.parents?.[0])) return json(res, 404, { error: { code: 404, message: 'File not found' } });
      const session = `http://127.0.0.1:${PORT}/mock/google/session/${encodeURIComponent(meta.name)}`;
      res.writeHead(200, { Location: session }).end();
    });
  }
  if (req.method === 'PUT' && p.startsWith('/mock/google/session/')) {
    const name = decodeURIComponent(p.slice('/mock/google/session/'.length));
    const id = `file-${randomBytes(4).toString('hex')}`;
    return receiveRaw(req, `googledrive:${name}`, () => json(res, 200, { id, webViewLink: `https://drive.google.com/file/d/${id}/view` }));
  }
  const perm = /^\/mock\/google\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(p);
  if (req.method === 'POST' && perm) {
    return readBody((body) => {
      hosts.driveShared.push({ id: perm[1], ...body });
      json(res, 200, { id: 'anyoneWithLink' });
    });
  }
  json(res, 404, { error: { code: 404, message: 'not found' } });
}

function mockYandex(req, res, p, url) {
  // The PUT to the upload URL needs no token, like the real uploader hosts.
  if (req.method === 'PUT' && p.startsWith('/mock/yandex/uploader/')) {
    const path = decodeURIComponent(p.slice('/mock/yandex/uploader/'.length));
    return receiveRaw(req, `yandex:${path}`, () => {
      hosts.yandexFiles.add(path);
      res.writeHead(201).end();
    });
  }
  if (req.headers.authorization !== 'OAuth test-token') return json(res, 401, { error: 'UnauthorizedError', description: 'Unauthorized' });
  const path = url.searchParams.get('path');
  if (req.method === 'GET' && p === '/mock/yandex/v1/disk/') return json(res, 200, { user: { login: 'tester', display_name: 'Tester' } });
  if (req.method === 'GET' && p === '/mock/yandex/v1/disk/resources/upload') {
    if (hosts.yandexFiles.has(path)) return json(res, 409, { error: 'DiskResourceAlreadyExistsError', description: 'Resource already exists' });
    return json(res, 200, { href: `http://127.0.0.1:${PORT}/mock/yandex/uploader/${encodeURIComponent(path)}`, method: 'PUT', templated: false });
  }
  if (req.method === 'PUT' && p === '/mock/yandex/v1/disk/resources/publish') {
    hosts.yandexPublished.push(path);
    return json(res, 200, { href: `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(path)}`, method: 'GET' });
  }
  if (req.method === 'GET' && p === '/mock/yandex/v1/disk/resources') {
    if (!hosts.yandexPublished.includes(path)) return json(res, 200, {});
    return json(res, 200, { public_url: `https://yadi.sk/d/${createHash('md5').update(path).digest('hex').slice(0, 10)}` });
  }
  json(res, 404, { error: 'NotFound' });
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => c.split('=')));
}

function hostPage(variant, token, name) {
  const actions = {
    'form-post': `<form method="post" action="/host/dl"><input type="hidden" name="token" value="${token}"><button id="dl" type="submit">Download</button></form>`,
    // Like GoFile: the button is not a link; script creates one and clicks it.
    'js-download': `<button id="dl" type="button">Download</button>
<script>document.getElementById('dl').onclick = () => {
  const a = document.createElement('a'); a.href = '/host/dl/${token}'; a.download = ''; document.body.append(a); a.click(); a.remove(); };</script>`,
    // The page fetches the bytes itself and saves them from a blob: URL.
    blob: `<button id="dl" type="button">Download</button>
<script>document.getElementById('dl').onclick = async () => {
  const blob = await (await fetch('/host/dl/${token}')).blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = ${JSON.stringify(name)}; document.body.append(a); a.click(); a.remove(); };</script>`,
  };
  const action = actions[variant] ?? `<a id="dl" href="/host/dl/${token}">Download</a>`;
  return `<!doctype html><title>Fake host</title>
<p id="wait">Your download will be ready in <span id="n">2</span> seconds…</p>
<div id="ready" hidden>${action}</div>
<script>
  let n = 2; const t = setInterval(() => { n--; document.getElementById('n').textContent = n;
    if (n <= 0) { clearInterval(t); document.getElementById('wait').hidden = true; document.getElementById('ready').hidden = false; } }, 1000);
</script>`;
}

function serveToken(req, res, token) {
  const t = tokens.get(token);
  const sess = cookies(req).sess;
  if (!t) return res.writeHead(404).end('no such token');
  if (!sess || sess !== t.sess) {
    t.rejectedNoCookie = (t.rejectedNoCookie ?? 0) + 1;
    return res.writeHead(403).end('session cookie missing');
  }
  if (t.single && t.used) return res.writeHead(410).end('link already used');
  t.used = (t.used ?? 0) + 1;
  streamFile(res, t.size, t.name, { 'Content-Disposition': `attachment; filename="${t.name}"` });
}

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'GET' && p === '/file') {
    const size = Number(url.searchParams.get('size'));
    const name = url.searchParams.get('name') ?? `file-${size}`;
    return streamFile(res, size, name);
  }

  if (req.method === 'GET' && p.startsWith('/file/')) {
    const name = decodeURIComponent(p.slice('/file/'.length));
    return streamFile(res, Number(url.searchParams.get('size')), name, {}, { chunked: url.searchParams.has('chunked') });
  }

  if (req.method === 'GET' && p === '/page.html') {
    return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>A page</title><p>Not a file');
  }

  if (req.method === 'POST' && p === '/mock/gofile/uploadfile') {
    const auth = req.headers.authorization;
    gofileAuth.push(auth ?? null);
    return receiveMultipart(req, 'file', (file) => {
      const code = randomBytes(4).toString('hex');
      const data = { downloadPage: `https://gofile.io/d/${code}`, parentFolder: randomBytes(8).toString('hex'), name: file.filename };
      if (!auth) data.guestToken = 'guest-test-token';
      received[`gofile:${file.filename}`] = file;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'ok', data }));
    });
  }

  if (req.method === 'POST' && p === '/mock/catbox/api.php') {
    return receiveMultipart(req, 'fileToUpload', (file, fields) => {
      if (fields.reqtype !== 'fileupload') return res.writeHead(400).end('Bad reqtype');
      if (file.filename.includes('reject')) return res.writeHead(412).end('File type not allowed');
      received[`catbox:${file.filename}`] = file;
      const ext = file.filename.includes('.') ? file.filename.split('.').pop() : 'bin';
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`https://files.catbox.moe/${randomBytes(3).toString('hex')}.${ext}`);
    });
  }

  if (p.startsWith('/mock/pixeldrain/')) return mockPixeldrain(req, res, p, url);
  if (p.startsWith('/mock/google/')) return mockGoogle(req, res, p, url);
  if (p.startsWith('/mock/yandex/')) return mockYandex(req, res, p, url);

  if (req.method === 'PUT' && p.startsWith('/upload/put/')) {
    const name = decodeURIComponent(p.slice('/upload/put/'.length));
    const hash = createHash('sha256');
    let bytes = 0;
    req.on('data', (c) => { hash.update(c); bytes += c.length; });
    req.on('end', () => {
      received[`put:${name}`] = { bytes, sha256: hash.digest('hex') };
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, url: `http://127.0.0.1:${PORT}/f/${name}` }));
    });
    return;
  }

  if (req.method === 'POST' && p.startsWith('/upload/multipart/')) {
    const name = decodeURIComponent(p.slice('/upload/multipart/'.length));
    const bb = Busboy({ headers: req.headers, limits: { fileSize: Infinity } });
    bb.on('file', (_field, stream, info) => {
      const hash = createHash('sha256');
      let bytes = 0;
      stream.on('data', (c) => { hash.update(c); bytes += c.length; });
      stream.on('end', () => { received[`multipart:${name}`] = { bytes, sha256: hash.digest('hex'), filename: info.filename }; });
    });
    bb.on('close', () => res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`http://127.0.0.1:${PORT}/f/${name}`));
    req.pipe(bb);
    return;
  }

  if (req.method === 'GET' && p === '/stats') {
    const tokenInfo = Object.fromEntries([...tokens].map(([k, v]) => [k, { name: v.name, used: v.used ?? 0, rejectedNoCookie: v.rejectedNoCookie ?? 0 }]));
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ served, received, tokens: tokenInfo, gofileAuth, hosts: { ...hosts, yandexFiles: [...hosts.yandexFiles] } }, null, 2));
  }

  if (req.method === 'GET' && p === '/host/page') {
    const variant = url.searchParams.get('variant') ?? 'link-multi';
    const size = Number(url.searchParams.get('size') ?? 10 * BLOCK);
    const name = url.searchParams.get('name') ?? `${variant}.bin`;
    const sess = randomBytes(8).toString('hex');
    const token = randomBytes(8).toString('hex');
    sessions.add(sess);
    tokens.set(token, { sess, single: variant === 'link-single', size, name });
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Set-Cookie': `sess=${sess}; Path=/; HttpOnly; SameSite=Lax`,
    });
    return res.end(hostPage(variant, token, name));
  }

  if (req.method === 'GET' && p.startsWith('/host/dl/')) return serveToken(req, res, p.slice('/host/dl/'.length));

  if (req.method === 'POST' && p === '/host/dl') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => serveToken(req, res, new URLSearchParams(body).get('token')));
    return;
  }

  res.writeHead(404).end('not found');
}).listen(PORT, '127.0.0.1', () => console.log(`spike server on http://127.0.0.1:${PORT}`));
