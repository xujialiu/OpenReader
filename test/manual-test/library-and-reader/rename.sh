#!/bin/bash
# rename.sh UDID "NEW NAME" PORT — set the Scroll Fixture's display name with the
# app stopped, then relaunch it against this tree's Metro on PORT (bar-title.md).
#
# Writes the name into Documents/display-names.json and library.json (the two
# places a renamed title lives, #73's rename) for the Document
# sha256:9acbcbe4…, terminates the app first (a running app rewrites both files
# from memory), and launches with -RCT_jsLocation so the Debug app loads this
# tree's bundle. Edit the `id=` line for another Document.
set -euo pipefail
udid=$1
name=$2
port=$3
container=$(xcrun simctl get_app_container "$udid" top.xujialiu.openreader data)
doc="$container/Documents"
id='sha256:9acbcbe4480c15ba1319ecf56bad78e13a478470d2107f89791ba0f5b74f1606'
xcrun simctl terminate "$udid" top.xujialiu.openreader 2>/dev/null || true
sleep 1
python3 - "$doc" "$id" "$name" <<'PY'
import json, sys
doc, did, name = sys.argv[1], sys.argv[2], sys.argv[3]
p = f"{doc}/display-names.json"
d = json.load(open(p))
d.setdefault("names", {})[did] = name
json.dump(d, open(p, "w"), ensure_ascii=False)
p = f"{doc}/library.json"
d = json.load(open(p))
for e in d.get("entries", []):
    if e.get("id") == did:
        e["title"] = name
json.dump(d, open(p, "w"), ensure_ascii=False)
print("renamed to:", name)
PY
xcrun simctl launch "$udid" top.xujialiu.openreader -RCT_jsLocation "localhost:$port"
