#!/bin/bash
# #35: does a moved highlight leave a strip of its colour behind? A screenshot answers.
#
#   bash test/manual-test/leading-strip.sh SIMULATOR_UDID OUTPUT_DIR app METRO_LOG DOCUMENT_ID [LINE_HEIGHT]
#   bash test/manual-test/leading-strip.sh SIMULATOR_UDID OUTPUT_DIR page [QUERY]
#
# app:  drives the reader's own highlighter inside its WebView through the
#       walkthrough harness's `js`, with the messages the bridge sends — a fresh
#       display of the chapter, one 'speak' with reveal (so the centring scrolls),
#       a word every 250 ms, and a 'hold' on the first word of the second line —
#       then photographs the screen. Needs `Leading Strip Fixture` in the Library
#       (leading-strip-fixture.ts, then the harness's `add`) and this worktree's
#       Metro writing to METRO_LOG. Sets the dark theme and Font Size 28 for the
#       run and puts both back. Plays nothing: no Provider, no audio, and no
#       reading position is written, so a simulator with sync on writes nothing.
#       LINE_HEIGHT (e.g. 1.6) is set on the chapter's <p> for the run.
# page: opens leading-strip.html in Safari, from a server this script starts:
#       WebKit alone, no epub.js and no app. QUERY is passed to the page
#       (`fix=1`, `lh=1.6`, `delay=600`).
#
# Exit 1 = RED (a stale strip is on the screen), 0 = GREEN, 2 = INVALID (no word
# was on the screen, so nothing was measured). OUTPUT_DIR keeps the screenshot.
set -u
UDID=$1
OUT=$2
MODE=$3
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"
LINE_PX=102

if [ "$MODE" = page ]; then
  QUERY=${4:-}
  PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$HERE" > "$OUT/http.log" 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null' EXIT
  sleep 1
  xcrun simctl openurl "$UDID" "http://127.0.0.1:$PORT/leading-strip.html?$QUERY&t=$(date +%s)"
  # The page holds its word about 2 s after it loads. Safari's first launch on a
  # device shows its Start Page for up to 20 s first, so poll until a word is there.
  for i in $(seq 1 15); do
    sleep 3
    xcrun simctl io "$UDID" screenshot "$OUT/page.png" > /dev/null 2>&1
    python3 "$HERE/leading-strip.py" "$OUT/page.png" "$LINE_PX" > "$OUT/page.txt"
    status=$?
    [ $status -ne 2 ] && break
  done
  cat "$OUT/page.txt"
  exit $status
fi

[ "$MODE" = app ] || { echo "MODE is app or page" >&2; exit 64; }
METRO_LOG=$4
DOCUMENT_ID=$5
LINE_HEIGHT=${6:-}
DATA=$(xcrun simctl get_app_container "$UDID" top.xujialiu.openreader data)
HARNESS="$DATA/Documents/harness.json"
SEQ=$(( $(date +%s) % 1000000 * 10 ))

# One harness command, then wait. `seq` must be new every time (README, Pitfalls).
hx() {
  SEQ=$((SEQ + 1))
  python3 -c 'import json,sys,os; c=json.loads(sys.argv[1]); c["seq"]=int(sys.argv[2]); open(sys.argv[3]+".tmp","w").write(json.dumps(c)); os.replace(sys.argv[3]+".tmp", sys.argv[3])' "$1" "$SEQ" "$HARNESS"
  sleep "${2:-1}"
}

# The theme and size the run changes, read back from the app's own settings file.
WAS=$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1]))["settings"]; print(json.dumps({"theme": s["theme"], "appearance": s["appearance"]}))' "$DATA/Documents/settings.json")
restore() {
  hx "{\"do\":\"settings\",\"patch\":$WAS}" 1
  rm -f "$HARNESS"
}
trap restore EXIT

# To the front first: the harness runs in a backgrounded app too, and a screenshot
# then photographs whatever is in front (Safari, after a page run) — README, Pitfalls.
xcrun simctl launch "$UDID" top.xujialiu.openreader > /dev/null
sleep 2
hx '{"do":"settings","patch":{"theme":"dark","appearance":{"font":null,"size":28}}}' 1
hx '{"do":"shut"}' 2
hx "{\"do\":\"open\",\"id\":\"$DOCUMENT_ID\"}" 8

# The program, as the body of the harness's function (leading-strip-probe.js).
CODE="$(cat "$HERE/leading-strip-probe.js")
return leadingStripProbe($(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$LINE_HEIGHT"));"
BEFORE=$(wc -l < "$METRO_LOG")
hx "$(python3 -c 'import json,sys; print(json.dumps({"do": "js", "code": sys.argv[1]}))' "$CODE")" 6
ANSWER=$(tail -n +"$((BEFORE + 1))" "$METRO_LOG" | grep -o 'PROBE [^"]*' | head -1)
echo "${ANSWER:-no answer from the reader}"
xcrun simctl io "$UDID" screenshot "$OUT/app.png" > /dev/null 2>&1
# No answer means the program never ran in a reader, so the screenshot shows
# something else: the same INVALID the detector gives a screen with no word on it.
[ "$ANSWER" = "PROBE leading strip probe started" ] || { echo "INVALID $OUT/app.png"; exit 2; }
python3 "$HERE/leading-strip.py" "$OUT/app.png" "$LINE_PX"
