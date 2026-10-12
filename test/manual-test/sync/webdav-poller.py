#!/usr/bin/env python3
# Host-side WebDAV probe/poller for the #155 fix verification (ios-test, 2026-10-13).
# Reads url/username/password from files (mode 600) and never prints them or the URL.
# Usage:
#   webdav-poller.py once FILE   -> one GET of the positions file, prints item summary lines
#   webdav-poller.py poll FILE SECONDS OUTLOG  -> poll GET every 2 s, log status + Last-Modified + item summary
# The positions file lives at <folder>/xujialiu-positions.json (src/core/sync/positions-file.ts).
import sys, time, os, json, urllib.parse, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
POSITIONS_NAME = "xujialiu-positions.json"

def load(dirpath):
    # dirpath is either a directory holding url.txt/user.txt/pass.txt or a
    # filename prefix such as /tmp/openreader-fix8-
    import glob
    if os.path.isdir(dirpath):
        j = lambda n: os.path.join(dirpath, n + ".txt")
    else:
        j = lambda n: dirpath + n + ".txt"
    url = open(j("url")).read().strip()
    user = open(j("user")).read().strip()
    pwd = open(j("pass")).read().strip()
    return url.rstrip("/"), user, pwd

def call(url, user, pwd, method, path):
    # quote the path segments, keep scheme/host (pitfalls/webdav.md)
    scheme, rest = url.split("://", 1)
    host, _, base = rest.partition("/")
    quoted = "/".join(urllib.parse.quote(seg) for seg in filter(None, (base + "/" + path).split("/")))
    req = urllib.request.Request(f"{scheme}://{host}/{quoted}", method=method, data=(b"" if method == "PROPFIND" else None))
    req.add_header("User-Agent", UA)
    req.add_header("Depth", "1")
    import base64
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{user}:{pwd}".encode()).decode())
    return urllib.request.urlopen(req, timeout=30)

def summarize(text):
    try:
        data = json.loads(text)
    except Exception as e:
        return f"not-json ({e})"
    items = data.get("items", data if isinstance(data, list) else [])
    lines = []
    for it in items:
        if not isinstance(it, dict):
            lines.append(f"  carried/other: {str(it)[:60]}")
            continue
        iid = str(it.get("id"))[:20]
        anchor = it.get("anchor")
        exact = anchor.get("exact") if isinstance(anchor, dict) else None
        stamp = it.get("stamp") or {}
        lines.append(f'  id={iid} exact={str(exact)[:48]!r} device={stamp.get("device")!r} at={stamp.get("at")}')
    return "\n".join(lines) if lines else f"  (no items; keys={list(data.keys()) if isinstance(data, dict) else 'list'})"

def main():
    mode, dirpath = sys.argv[1], sys.argv[2]
    url, user, pwd = load(dirpath)
    if mode == "once":
        try:
            r = call(url, user, pwd, "GET", POSITIONS_NAME)
            body = r.read().decode()
            print(f"GET {POSITIONS_NAME}: {r.status}, Last-Modified: {r.headers.get('Last-Modified')}")
            print(summarize(body))
        except urllib.error.HTTPError as e:
            print(f"GET {POSITIONS_NAME}: HTTP {e.code}")
    elif mode == "poll":
        seconds = float(sys.argv[3]); out = sys.argv[4]
        seen = None
        end = time.time() + seconds
        with open(out, "a") as log:
            while time.time() < end:
                try:
                    r = call(url, user, pwd, "GET", POSITIONS_NAME)
                    body = r.read().decode()
                    lm = r.headers.get("Last-Modified")
                    line = f'{time.strftime("%H:%M:%S")} GET 200 lm={lm} len={len(body)}'
                    if body != seen:
                        seen = body
                        line += "\n" + summarize(body)
                    print(line, flush=True)
                    log.write(line + "\n"); log.flush()
                except urllib.error.HTTPError as e:
                    line = f'{time.strftime("%H:%M:%S")} GET HTTP {e.code}'
                    print(line, flush=True); log.write(line + "\n"); log.flush()
                except Exception as e:
                    line = f'{time.strftime("%H:%M:%S")} GET error {type(e).__name__} {e}'
                    print(line, flush=True); log.write(line + "\n"); log.flush()
                time.sleep(2)

if __name__ == "__main__":
    main()
