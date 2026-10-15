const http = require('node:http');

function splitBuffer(buf, delim) {
  const idxs = [];
  let pos = 0;
  while (true) {
    const i = buf.indexOf(delim, pos);
    if (i === -1) break;
    idxs.push(i);
    pos = i + delim.length;
  }
  const out = [];
  for (let k = 0; k < idxs.length - 1; k++) {
    let s = idxs[k] + delim.length;
    if (buf[s] === 13 && buf[s + 1] === 10) s += 2;
    let e = idxs[k + 1];
    if (buf[e - 2] === 13 && buf[e - 1] === 10) e -= 2;
    out.push(buf.slice(s, e));
  }
  return out;
}

function parseMultipart(buf, boundary) {
  const bBoundary = Buffer.from('--' + boundary);
  const parts = splitBuffer(buf, bBoundary);
  const files = [];
  for (const p of parts) {
    const hEnd = p.indexOf(Buffer.from('\r\n\r\n'));
    if (hEnd === -1) continue;
    const headers = p.slice(0, hEnd).toString('latin1');
    const body = p.slice(hEnd + 4);
    const cd = (headers.match(/Content-Disposition:[^\r\n]*/i) || [''])[0];
    const filename = (cd.match(/filename="([^"]*)"/) || [])[1];
    if (filename) files.push({ filename, body });
  }
  return files;
}

function startMockServer() {
  return new Promise((resolve) => {
    const files = new Map();
    let seq = 0;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      const fileMatch = url.pathname.match(/^\/file\/bot[^/]+\/(.+)$/);
      if (req.method === 'GET' && fileMatch) {
        const fid = fileMatch[1].replace(/^files\//, '').replace(/\.bin$/, '');
        const buf = files.get(fid);
        if (!buf) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(buf);
        return;
      }

      const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
      if (req.method === 'POST' && m) {
        const method = m[2];
        const ct = req.headers['content-type'] || '';
        const chunks = [];
        req.on('data', (d) => chunks.push(d));
        req.on('end', () => {
          const buf = Buffer.concat(chunks);

          if (method === 'sendDocument') {
            const boundary = ct.split('boundary=')[1];
            const parsed = parseMultipart(buf, boundary);
            const fid = `fid_${++seq}`;
            files.set(fid, parsed[0] ? parsed[0].body : Buffer.alloc(0));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              result: {
                message_id: seq,
                document: { file_id: fid, file_name: parsed[0] ? parsed[0].filename : 'file.bin' }
              }
            }));
            return;
          }

          let json = {};
          try { json = JSON.parse(buf.toString('utf8') || '{}'); } catch (e) {}

          if (method === 'getFile') {
            const fid = json.file_id;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, result: { file_id: fid, file_path: `files/${fid}.bin` } }));
            return;
          }

          if (method === 'getMe') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, result: { id: 1, username: 'mockbot' } }));
            return;
          }

          if (method === 'getChat') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, result: { id: json.chat_id, type: 'channel', title: 'Mock Channel' } }));
            return;
          }

          if (method === 'getChatAdministrators') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, result: [{ user: { id: 1 } }] }));
            return;
          }

          if (method === 'deleteMessage') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, result: true }));
            return;
          }

          if (method === 'getUpdates') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, result: [] }));
            return;
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, result: {} }));
        });
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

module.exports = { startMockServer };
