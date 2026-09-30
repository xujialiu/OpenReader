#!/usr/bin/env node
// A one-folder WebDAV server that holds the Positions File's GET and PUT long
// enough to drive the pre-Play sync's 2 s bound (`use-sync.ts` `WAIT_MS`) from
// the outside — the helper for the #106 shape: Play waits for a sync, the
// owner leaves inside the wait, and the late continuation must start nothing.
//
//   node test/manual-test/sync/delaying-webdav.cjs [PORT] [DELAY_MS]
//
// Default port 8722, default delay 4 000 ms. Every request is logged with a
// millisecond wall-clock time, which is how a run's moments are timed against
// the app's Debug Log:
//
//   <counter> <ISO-ms> <METHOD> <path> delay=<held ms> [bytes=<n>]
//
// The folder is one URL path segment deep and in memory only: GET answers 404
// until this server's first PUT, then the latest PUT's body; PROPFIND lists
// what it holds; MKCOL answers 405 (the folder already exists, the app's own
// client reads that as fine). Any username and password are accepted — point
// the app at it with throwaway credentials, never real ones. Each PUT body is
// also written to $OPENREADER_DELAY_WEBDAV_STATE/latest-positions.json so the
// host can read what the app uploaded.
//
// DELAY_MS=0 is the fast server for a sync that finishes inside the wait.

const { Buffer } = require('node:buffer');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.argv[2] ?? 8722);
const DELAY_MS = Number(process.argv[3] ?? 4000);
const STATE_DIR =
  process.env.OPENREADER_DELAY_WEBDAV_STATE ?? `/tmp/openreader-delay-webdav-${PORT}`;
const LOG = process.env.OPENREADER_DELAY_WEBDAV_LOG ?? path.join(STATE_DIR, 'requests.log');
fs.mkdirSync(STATE_DIR, { recursive: true });

/** name -> body (Buffer) */
const files = new Map();
let served = 0;

const rfc1123 = () => new Date().toUTCString();

const multistatus = (responses) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<d:multistatus xmlns:d="DAV:">' +
  responses.map((r) => `<d:response><d:href>${r.href}</d:href>` +
    `<d:propstat><d:prop><d:getlastmodified>${r.lastModified ?? rfc1123()}</d:getlastmodified>` +
    `<d:resourcetype>${r.collection ? '<d:collection/>' : ''}</d:resourcetype></d:prop>` +
    '<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>').join('') +
  '</d:multistatus>';

const logLine = (line) => {
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
};

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    // The first path segment after the leading slash is the folder; the rest, the file.
    const parts = req.url.split('/').filter(Boolean).map(decodeURIComponent);
    const folder = parts.length ? parts[0] : '';
    const file = parts.length > 1 ? parts.slice(1).join('/') : null;
    const isPositions = file !== null && file.endsWith('.json');
    const hold = (req.method === 'GET' || req.method === 'PUT') && isPositions ? DELAY_MS : 0;

    const answer = () => {
      served += 1;
      const when = new Date().toISOString();
      if (req.method === 'PROPFIND') {
        const depth = String(req.headers.depth ?? '0');
        const responses = [{ href: `/${folder}/`, collection: true }];
        if (depth === '1') {
          for (const [name] of files) {
            responses.push({ href: `/${folder}/${encodeURIComponent(name)}` });
          }
        }
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
        res.end(multistatus(responses));
        logLine(`${served} ${when} PROPFIND depth=${depth} delay=0 files=${files.size}`);
        return;
      }
      if (req.method === 'MKCOL') {
        // The folder always exists here; 405 is the app's "already there".
        res.writeHead(405);
        res.end();
        logLine(`${served} ${when} MKCOL delay=0 status=405`);
        return;
      }
      if (req.method === 'PUT' && file !== null) {
        files.set(file, body);
        if (isPositions) {
          fs.writeFileSync(path.join(STATE_DIR, 'latest-positions.json'), body);
        }
        res.writeHead(201, { 'Content-Length': '0' });
        res.end();
        logLine(`${served} ${when} PUT /${folder}/${file} delay=${hold} bytes=${body.length}`);
        return;
      }
      if (req.method === 'GET' && file !== null) {
        const hit = files.get(file);
        res.writeHead(hit ? 200 : 404, hit
          ? { 'Content-Type': 'application/json', 'Content-Length': String(hit.length) }
          : { 'Content-Length': '0' });
        res.end(hit ?? undefined);
        logLine(`${served} ${when} GET /${folder}/${file} delay=${hold} status=${hit ? 200 : 404}`);
        return;
      }
      res.writeHead(200);
      res.end();
      logLine(`${served} ${when} ${req.method} /${folder}${file ? `/${file}` : ''} delay=0`);
    };

    if (hold > 0) setTimeout(answer, hold);
    else answer();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`delaying webdav on http://127.0.0.1:${PORT}/ (holding positions GET/PUT ${DELAY_MS} ms)`);
});
