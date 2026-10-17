#!/usr/bin/env node
/**
 * fix2-dav-stub.cjs — isolated local WebDAV stub for verifying #178 on the
 * fix2-recovery-check simulator (ios-tester, 2026-10-17).
 *
 * Speaks just what src/core/sync/webdav.ts needs: PROPFIND (Depth 0/1) 207,
 * GET of the Positions File, PUT of it, MKCOL. Server-side truth is a plain
 * directory, so the host can stage exact file states between syncs:
 *
 *   davroot/xujialiu-positions.json   the file the app reads and replaces;
 *                                     absent means GET 404
 *   davroot/PUT_FAIL                  while present, every PUT answers 500 and
 *                                     stores nothing (reply-with-error shape)
 *   davroot/access.log                one line per request: time, method,
 *                                     path, status, stored bytes
 *
 * Any Basic credentials are accepted (the values are throwaway); the flag
 * file is checked and cleared by the caller. Never point the app at any
 * real host with this.
 *
 *   node fix2-dav-stub.cjs PORT davroot
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.argv[2]);
const root = path.resolve(process.argv[3]);
fs.mkdirSync(root, { recursive: true });
const positionsPath = path.join(root, 'xujialiu-positions.json');
const putFailPath = path.join(root, 'PUT_FAIL');
const logPath = path.join(root, 'access.log');

function log(line) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
}

function multistatus(hrefs) {
  const entries = hrefs
    .map((h) => `<D:response><D:href>${h}</D:href><D:propstat><D:prop><D:getlastmodified>Mon, 17 Oct 2026 00:00:00 GMT</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${entries}</D:multistatus>`;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const decoded = decodeURIComponent(req.url);
    if (req.method === 'PROPFIND') {
      const self = decoded.endsWith('/') ? decoded : decoded.replace(/\/[^/]*$/, '/');
      const names = fs.existsSync(positionsPath) ? [self + 'xujialiu-positions.json'] : [];
      const xml = req.headers.depth === '1' ? multistatus(names.length ? names : []) : multistatus([self]);
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8', DAV: '1' });
      log(`PROPFIND ${req.url} depth=${req.headers.depth} -> 207 (${names.length} files)`);
      res.end(xml);
      return;
    }
    if (req.method === 'MKCOL') {
      res.writeHead(405); // folder exists after all; the app accepts 405
      log(`MKCOL ${req.url} -> 405`);
      res.end();
      return;
    }
    if (req.method === 'GET') {
      if (!decoded.endsWith('xujialiu-positions.json')) { res.writeHead(404); res.end(); log(`GET ${req.url} -> 404 (not the positions file)`); return; }
      if (!fs.existsSync(positionsPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        log(`GET positions -> 404 (absent)`);
        return;
      }
      const text = fs.readFileSync(positionsPath);
      res.writeHead(200, { 'Content-Type': 'application/json', Date: new Date().toUTCString(), 'Cache-Control': 'no-cache' });
      res.end(text);
      log(`GET positions -> 200 (${text.length} bytes)`);
      return;
    }
    if (req.method === 'PUT') {
      if (fs.existsSync(putFailPath)) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('stubbed storage refusal');
        log(`PUT positions -> 500 (PUT_FAIL flag; ${body.length} bytes NOT stored)`);
        return;
      }
      fs.writeFileSync(positionsPath, body);
      res.writeHead(201, { 'Content-Type': 'text/plain' });
      res.end('Created');
      log(`PUT positions -> 201 (${body.length} bytes stored)`);
      return;
    }
    res.writeHead(405);
    res.end();
    log(`${req.method} ${req.url} -> 405`);
  });
});

server.listen(port, '127.0.0.1', () => log(`fix2-dav-stub listening on 127.0.0.1:${port} root=${root}`));
