#!/usr/bin/env node
// A controlled one-folder WebDAV server for the #166/#168/#177 simulator runs:
// the three things the real-host stubs could not do, in one process.
//
//   node test/manual-test/sync/cacheable-dav.cjs [PORT]     # default 8765
//
// - **Cacheable** (#166): every GET of the Positions File answers with
//   `Cache-Control: public, max-age=3600`, a backdated `Last-Modified`
//   (one year ago) and a content-hash `ETag`, always 200 (never 304), so the
//   iOS URL cache holds it as fresh for an hour. This is what lets a stale
//   copy be proved instead of waited for.
// - **Stalling** (#168): `/__stall?on=1` makes the next GET (one shot) send
//   the success headers with the true Content-Length and then never write the
//   body. The socket stays open until the client gives up, and the server logs
//   the close with its elapsed time — the cancellation evidence.
// - **Auth** (#177): `/__accept?list=<password>[,<password>]` restricts the
//   accepted Basic passwords to that list (comma-separated, URL-encoded);
//   `list=*` accepts anything again. Rejected requests answer 401. Passwords
//   are compared, never logged.
//
// Host-side control endpoints (all plain curl, no auth):
//   /__state                 counters, modes, served-content hash
//   /__set                   POST body = the Positions File to serve from now on
//   /__stall?on=1|on=0       arm/disarm the one-shot stalled GET
//   /__accept?list=a,b|*     restrict the accepted Basic passwords
//
// Every request is logged with a millisecond wall-clock time, the method, the
// path, the headers that decide the questions here — `Cache-Control`,
// `If-None-Match`, `If-Modified-Since`, `Depth`, `Authorization` **masked** to
// its scheme and length — plus PUT item summaries and the stall's close
// events, appended to <STATE>/requests.log and echoed to stdout.
//
// Before the first /__set the folder answers 404 to the Positions File's GET
// (the ordinary first run, which the app's client reads as "not found yet");
// PROPFIND always answers 207. MKCOL answers 405 (already there). PUT answers
// 201 and the body is kept verbatim under <STATE>/puts/.
//
// What it cannot prove: it is not a WebDAV server — it speaks only the four
// calls the app's client makes against the fixed Positions File name, and its
// cacheability is by construction (`Cache-Control` on every GET), not by
// configuration.

const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.argv[2] ?? 8765);
const STATE = process.env.OPENREADER_FIX2_DAV_STATE ?? `/tmp/openreader-fix2-dav`;
const POSITIONS_NAME = 'xujialiu-positions.json';
const SERVED = path.join(STATE, 'positions-served.json');
const LOG = path.join(STATE, 'requests.log');
const PUTS = path.join(STATE, 'puts');
fs.mkdirSync(PUTS, { recursive: true });

const counters = { get: 0, get404: 0, put: 0, propfind: 0, mkcol: 0, rejected401: 0, stalls_done: 0 };
const modes = { stall_next_get: false, acceptedPasswords: null };
/** One-shot slow body: headers flushed at once, body delivered after ms. */
const holdNext = { ms: 0 };
/** One-shot partial body: headers + half the body flushed, then stall. */
const halveNext = { on: false };

function log(line) {
  const stamp = new Date().toISOString();
  fs.appendFileSync(LOG, `${stamp} ${line}\n`);
  console.log(`${stamp} ${line}`);
}

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const servedBody = () => { try { return fs.readFileSync(SERVED); } catch { return null; } };
const backdatedLastModified = () => new Date(Date.now() - 365 * 24 * 3600 * 1000).toUTCString();

/** Scheme and length only; never the secret itself. */
function maskAuth(value) {
  if (value === undefined) return undefined;
  const scheme = value.split(' ')[0] ?? '?';
  return `${scheme} len=${value.length}`;
}

function decodePassword(header) {
  // Returns the Basic password, or null when the header is absent/unparsable.
  if (!header || !/^Basic /i.test(header)) return null;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    return colon < 0 ? '' : decoded.slice(colon + 1);
  } catch {
    return null;
  }
}

function authAllowed(header) {
  if (modes.acceptedPasswords === null) return true;
  return modes.acceptedPasswords.includes(decodePassword(header));
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const h = (name) => req.headers[name.toLowerCase()];
    const interesting = {
      'cache-control': h('cache-control'),
      'if-none-match': h('if-none-match'),
      'if-modified-since': h('if-modified-since'),
      depth: h('depth'),
      'user-agent': h('user-agent'),
      authorization: maskAuth(h('authorization')),
    };
    const headersText = Object.entries(interesting)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => ` ${k}=${JSON.stringify(v)}`)
      .join('');

    const answer = (status, headers, payload) => {
      // A missing Date is a common NSURLCache store-blocker; the controlled
      // cacheability of this stub depends on the response being stored.
      res.writeHead(status, { Date: new Date().toUTCString(), ...headers });
      res.end(payload);
      // Control queries can carry secrets; log the redacted form for them.
      const loggedUrl = req.url.startsWith('/__accept') ? controlUrl : req.url;
      log(`${req.method} ${loggedUrl} -> ${status}${headersText}`);
    };

    // Control endpoints (host-side, no auth, never seen by the app).
    // Their queries can carry secrets (/__accept's password list); the log
    // line and the answer below use a redacted form, never the raw URL.
    const controlUrl = req.url.startsWith('/__accept')
      ? `/__accept?list=<redacted>`
      : req.url;
    if (req.url === '/__state') {
      const current = servedBody();
      return answer(200, { 'Content-Type': 'application/json' }, JSON.stringify({
        counters,
        modes: {
          stall_next_get: modes.stall_next_get,
          acceptedPasswordCount: modes.acceptedPasswords === null ? null : modes.acceptedPasswords.length,
        },
        served: current ? { bytes: current.length, sha: hash(current) } : null,
      })), void (log(`__state served=${current ? hash(current) : 'none'}`));
    }
    if (req.url === '/__set' && req.method === 'POST') {
      fs.writeFileSync(SERVED + '.tmp', body);
      fs.renameSync(SERVED + '.tmp', SERVED);
      log(`__set ${body.length} bytes sha=${hash(body)}`);
      return answer(200, { 'Content-Type': 'text/plain' }, `set ${hash(body)}\n`);
    }
    if (req.url.startsWith('/__stall')) {
      modes.stall_next_get = req.url.includes('on=1');
      log(`__stall ${modes.stall_next_get ? 'ARMED' : 'disarmed'}`);
      return answer(200, { 'Content-Type': 'text/plain' }, `stall ${modes.stall_next_get ? 'armed' : 'disarmed'}\n`);
    }
    if (req.url.startsWith('/__halve')) {
      halveNext.on = req.url.includes('on=1');
      log(`__halve ${halveNext.on ? 'ARMED' : 'disarmed'}`);
      return answer(200, { 'Content-Type': 'text/plain' }, `halve ${halveNext.on ? 'armed' : 'disarmed'}\n`);
    }
    if (req.url.startsWith('/__hold')) {
      holdNext.ms = Number(new URL(req.url, 'http://x').searchParams.get('ms') ?? 0);
      log(`__hold next GET body delay=${holdNext.ms}ms`);
      return answer(200, { 'Content-Type': 'text/plain' }, `hold ${holdNext.ms}ms\n`);
    }
    if (req.url.startsWith('/__accept')) {
      const raw = new URL(req.url, 'http://x').searchParams.get('list');
      if (raw === '*' || raw === null) {
        modes.acceptedPasswords = null;
        log('__accept anything');
      } else {
        modes.acceptedPasswords = raw.split(',').map((p) => decodeURIComponent(p));
        log(`__accept list of ${modes.acceptedPasswords.length}`);
      }
      return answer(200, { 'Content-Type': 'text/plain' }, 'accept updated\n');
    }

    // WebDAV surface the app's client speaks.
    const isPositions = req.url.split('?')[0].endsWith(POSITIONS_NAME);

    if (req.method === 'OPTIONS') return answer(200, { DAV: '1,2', 'Content-Length': '0' }, undefined);
    if (req.method === 'MKCOL') {
      counters.mkcol += 1;
      return answer(405, { 'Content-Length': '0' }, undefined);
    }

    if (!authAllowed(h('authorization'))) {
      counters.rejected401 += 1;
      return answer(401, { 'WWW-Authenticate': 'Basic realm="fix2"', 'Content-Length': '0' }, undefined);
    }

    if (req.method === 'PROPFIND') {
      counters.propfind += 1;
      const current = servedBody();
      const host = h('host') ?? `127.0.0.1:${PORT}`;
      const href = `http://${host}/fix2dav/`;
      const entries = [`<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`];
      if (current) {
        entries.push(`<d:response><d:href>${href}${POSITIONS_NAME}</d:href><d:propstat><d:prop><d:getlastmodified>${backdatedLastModified()}</d:getlastmodified><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
      }
      const xml = `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`;
      return answer(207, { 'Content-Type': 'application/xml; charset=utf-8', DAV: '1,2' }, xml);
    }

    if (req.method === 'PUT' && isPositions) {
      counters.put += 1;
      const n = counters.put;
      fs.writeFileSync(path.join(PUTS, `PUT-${String(n).padStart(3, '0')}.json`), body);
      let summary = '(unparsed)';
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        summary = (parsed.items ?? []).map((it) =>
          `${String(it.id ?? '').slice(7, 15)} device=${it.stamp?.device} at=${it.stamp?.at} exact=${JSON.stringify(String(it.anchor?.exact ?? '').slice(0, 50))}`,
        ).join(' | ') || '(no items)';
      } catch (problem) {
        summary = `(unparsed: ${problem})`;
      }
      log(`PUT #${n} ${body.length} bytes -> ${summary}`);
      return answer(201, { 'Content-Length': '0' }, undefined);
    }

    if (req.method === 'GET' && isPositions) {
      const current = servedBody();
      if (!current) {
        counters.get404 += 1;
        return answer(404, { 'Content-Length': '0' }, undefined);
      }
      if (modes.stall_next_get) {
        // One shot: success headers, true Content-Length, body never written.
        modes.stall_next_get = false;
        counters.get += 1;
        log(`GET ${req.url} -> 200 STALLED (Content-Length ${current.length} promised, body withheld)${headersText}`);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(current.length),
          ETag: `"${hash(current)}"`,
        });
        // Node buffers writeHead's bytes until the first write/end: without
        // this flush the client never receives the headers, and a stall
        // measures a headers timeout, not the body timeout it exists for
        // (found 2026-10-13: curl --dump-header caught 0 bytes).
        res.flushHeaders();
        let closed = false;
        res.on('close', () => {
          if (closed) return;
          closed = true;
          counters.stalls_done += 1;
          log(`STALLED GET closed after ${Date.now() - started} ms (client gave up: ${!res.writableEnded})`);
        });
        return; // The body never comes.
      }
      counters.get += 1;
      if (halveNext.on) {
        // One shot: headers + half the body, then stall — whether expo/fetch's
        // promise resolves at the first body chunk decides which shape the
        // old header-only timeout could not bound.
        halveNext.on = false;
        const half = Math.floor(current.length / 2);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(current.length),
          ETag: `"${hash(current)}"`,
        });
        res.flushHeaders();
        res.write(current.subarray(0, half));
        log(`GET ${req.url} -> 200 PARTIAL (${half} of ${current.length} bytes flushed, rest withheld)${headersText}`);
        let halved = false;
        res.on('close', () => {
          if (halved) return;
          halved = true;
          log(`PARTIAL GET closed after ${Date.now() - started} ms (client gave up: ${!res.writableEnded})`);
        });
        return; // The rest never comes.
      }
      if (holdNext.ms > 0) {
        // One shot: headers flushed at once, body after the hold — the
        // discriminator for when expo/fetch's promise actually resolves.
        const holdMs = holdNext.ms;
        holdNext.ms = 0;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(current.length),
          ETag: `"${hash(current)}"`,
        });
        res.flushHeaders();
        log(`GET ${req.url} -> 200 HEADERS-FLUSHED (body withheld ${holdMs} ms)${headersText}`);
        setTimeout(() => {
          res.end(current);
          log(`HELD GET body delivered after ${Date.now() - started} ms total (hold ${holdMs} ms)`);
        }, holdMs);
        return;
      }
      return answer(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(current.length),
        'Cache-Control': 'public, max-age=3600',
        'Last-Modified': backdatedLastModified(),
        ETag: `"${hash(current)}"`,
      }, current);
    }

    answer(200, { 'Content-Length': '0' }, undefined);
  });
});

server.listen(PORT, '127.0.0.1', () => log(`cacheable-dav listening on 127.0.0.1:${PORT} state=${STATE}`));
