#!/usr/bin/env python3
"""A WebDAV stub for the #105 simulator run: one folder, one Positions File.

Answers what `src/core/sync/webdav.ts` asks:

- `PROPFIND` (Depth 0 or 1) on the folder -> `207` at once, a small
  multistatus naming the folder and the file.
- `GET` of the Positions File -> serves `<STATE>/positions-served.json`
  verbatim. Armed once with `/__arm?ms=N`, the next GET sleeps N ms first and
  then serves, which is how Play's two-second bound is overrun while the run
  is still in flight. Every GET's start and end is logged.
- `PUT` of the Positions File -> `201`, the body kept verbatim under
  `<STATE>/puts/` and one summary line appended to `<STATE>/puts.log` with
  the wall-clock time, the byte length, and every item's `device`, `stamp.at`
  and the first 60 characters of `anchor.exact`, so an upload's place is
  readable without opening the body.
- `MKCOL` -> `405` (the folder is always there); `OPTIONS` -> `200`.

Host-side control, for the run's phases:

    curl http://127.0.0.1:8899/__arm?ms=4000   # the next GET sleeps 4 s, once
    curl http://127.0.0.1:8899/__disarm
    curl http://127.0.0.1:8899/__state

State and artifacts live outside the repository, in `/tmp/openreader-105/`
(override with `OPENREADER_105_STATE`). Edit `positions-served.json` between
phases to change what the folder holds; the stub reads it on every request.

    python3 test/manual-test/sync/stub-105.py [PORT]     # default 8899

What it cannot prove: it is not a WebDAV server. It speaks only the four
calls the app's client makes against one fixed file name, and it never
answers 401/403, so it cannot exercise the auth or the missing-folder paths.
"""
import json
import os
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

STATE = os.environ.get('OPENREADER_105_STATE', '/tmp/openreader-105')
POSITIONS_NAME = 'xujialiu-positions.json'
EMPTY_FILE = {"format": "xujialiu-positions", "version": 1, "items": []}

os.makedirs(os.path.join(STATE, 'puts'), exist_ok=True)
served_path = os.path.join(STATE, 'positions-served.json')
if not os.path.exists(served_path):
    with open(served_path, 'w') as f:
        json.dump(EMPTY_FILE, f)

lock = threading.Lock()
counters = {'get': 0, 'put': 0, 'propfind': 0, 'delayed_gets_done': 0}
armed = {'ms': 0}


def log(line: str) -> None:
    stamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
    with open(os.path.join(STATE, 'stub.log'), 'a') as f:
        f.write(f'{stamp} {line}\n')
    print(f'{stamp} {line}', flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _reply(self, status: int, body: bytes, ctype: str = 'application/xml') -> None:
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('DAV', '1,2')
        self.end_headers()
        self.wfile.write(body)

    def _is_positions(self) -> bool:
        return urlparse(self.path).path.endswith(POSITIONS_NAME)

    def do_OPTIONS(self) -> None:
        self._reply(200, b'', 'text/plain')

    def do_MKCOL(self) -> None:
        self._reply(405, b'', 'text/plain')

    def do_PROPFIND(self) -> None:
        with lock:
            counters['propfind'] += 1
        depth = self.headers.get('Depth', '0')
        host = self.headers.get('Host', '127.0.0.1')
        href = f'http://{host}/dav/'
        xml = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<d:multistatus xmlns:d="DAV:">'
            f'<d:response><d:href>{href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
            f'<d:response><d:href>{href}{POSITIONS_NAME}</d:href><d:propstat><d:prop>'
            '<d:getlastmodified>Wed, 30 Sep 2026 00:00:00 GMT</d:getlastmodified><d:resourcetype/>'
            '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'
            '</d:multistatus>'
        )
        log(f'PROPFIND depth={depth} from={"app" if depth else "?"} -> 207')
        self._reply(207, xml.encode())

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == '/__state':
            body = json.dumps({'armed_ms': armed['ms'], 'counters': counters}).encode()
            return self._reply(200, body, 'application/json')
        if parsed.path == '/__arm':
            ms = int(parse_qs(parsed.query).get('ms', ['0'])[0])
            with lock:
                armed['ms'] = ms
            log(f'ARM next GET delay={ms}ms')
            return self._reply(200, b'armed', 'text/plain')
        if parsed.path == '/__disarm':
            with lock:
                armed['ms'] = 0
            log('DISARM')
            return self._reply(200, b'disarmed', 'text/plain')
        if not self._is_positions():
            return self._reply(404, b'not found', 'text/plain')

        with lock:
            delay, armed['ms'] = armed['ms'], 0
        if delay:
            log(f'GET start (holding {delay}ms)')
            time.sleep(delay / 1000.0)
        with open(served_path, 'rb') as f:
            body = f.read()
        if delay:
            with lock:
                counters['delayed_gets_done'] += 1
            log(f'GET end after hold, {len(body)} bytes served')
        else:
            log(f'GET immediate, {len(body)} bytes served')
        with lock:
            counters['get'] += 1
        self._reply(200, body, 'application/json')

    def do_PUT(self) -> None:
        if not self._is_positions():
            return self._reply(404, b'not found', 'text/plain')
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length)
        with lock:
            counters['put'] += 1
            n = counters['put']
        keep = os.path.join(STATE, 'puts', f'PUT-{n:03d}.json')
        with open(keep, 'wb') as f:
            f.write(body)
        try:
            items = json.loads(body).get('items', [])
            summary = '; '.join(
                f"{it.get('id', '')[:15]}… device={it.get('stamp', {}).get('device')} "
                f"at={it.get('stamp', {}).get('at')} exact={str(it.get('anchor', {}).get('exact', ''))[:60]!r}"
                for it in items
            ) or '(no items)'
        except Exception as problem:  # noqa: BLE001 - keep the body anyway
            summary = f'(unparsed: {problem})'
        line = f'PUT #{n} {len(body)} bytes -> {summary}'
        log(line)
        with open(os.path.join(STATE, 'puts.log'), 'a') as f:
            f.write(f'{datetime.now().isoformat(timespec="milliseconds")} {line}\n')
        self._reply(201, b'', 'text/plain')

    def log_message(self, fmt: str, *args: object) -> None:  # silence the default per-request stderr line
        return


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    log(f'stub-105 listening on 127.0.0.1:{port}, state in {STATE}')
    print(f'stub-105 listening on 127.0.0.1:{port}, state in {STATE}', flush=True)
    server.serve_forever()
