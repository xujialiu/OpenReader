#!/bin/bash
# Whether a pinch or a double tap magnifies the reading page (#79, design 0052).
#
#   bash test/manual-test/zoom.sh SIMULATOR_UDID METRO_PORT METRO_LOG NEW_OUTPUT_DIR
#   bash test/manual-test/zoom.sh SIMULATOR_UDID control NEW_OUTPUT_DIR
#
# The first form makes each gesture through ZoomProbe in a freshly launched
# app, because a magnified page stays magnified. For each it relaunches with
# the Metro port (which the probe's own `activate()` keeps, pitfalls/metro.md),
# opens `A Short Test of Reading Aloud` through the walkthrough harness, and
# waits for Metro's log to report its first section rendered: a gesture made
# before that lands on "Laying the document out…" and proves nothing. Then it
# asks the page for its own `visualViewport.scale` through the harness and
# prints one `ZOOM <gesture> scale=S …` line: S is 1 when the page did not
# magnify. It also prints `ZOOM mark <gesture> before=X after=Y`, the player's
# Following mark (A or M) around the gesture. Exits 1 when either gesture
# magnified the page or a pinch turned A into M, 2 when a step failed.
# Needs the fixture in the Library (short-test-fixture.ts). Nothing is played.
#
# The second form is the control: it serves a page with the reader's own
# viewport on port 8111 and pinches it in Safari, which must magnify.
#
# The harness's answer rides the reader's problem note, which stays on screen
# until the next Play (pitfalls/webview.md). The last relaunch here clears it.
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
simulator=${1:-}
probe() { # RUN_DIR METHOD DERIVED_DATA
  ruby "$source_dir/ios/project.rb" "$1" top.xujialiu.openreader NO inspect ZoomProbe.swift
  local status=0
  xcodebuild -project "$1/ManualTests.xcodeproj" -scheme LockScreenProbe \
    -destination "id=$simulator" -derivedDataPath "$3" -resultBundlePath "$1/result.xcresult" \
    "-only-testing:LockScreenProbe/ZoomProbe/$2" test > "$1/test.log" 2>&1 || status=$?
  grep -h 'Executed .* with' "$1/test.log" | tail -1 || true
  # A second export once hung for minutes (2026-09-28); never wait on it.
  perl -e 'alarm 60; exec @ARGV' xcrun xcresulttool export attachments \
    --path "$1/result.xcresult" --output-path "$1/attachments" > /dev/null 2>&1 || true
  return "$status"
}

if [[ $# -eq 3 && $2 == control ]]; then
  output=$3
  mkdir -p "$output" && output=$(cd "$output" && pwd)
  page="$output/page"
  mkdir -p "$page"
  cat > "$page/index.html" <<'HTML'
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>zoom</title></head>
<body style="font:18px serif;margin:20px"><h1 id="s">scale ?</h1><p>This is a short test of reading aloud, written for a machine to speak.</p>
<script>setInterval(function(){document.getElementById('s').textContent='scale '+visualViewport.scale.toFixed(2)},200)</script></body></html>
HTML
  (cd "$page" && python3 -m http.server 8111 > "$output/server.log" 2>&1) &
  server=$!
  trap 'kill $server 2>/dev/null' EXIT
  sleep 1
  xcrun simctl openurl "$simulator" http://localhost:8111/index.html
  sleep 5
  mkdir -p "$output/safari"
  status=0
  probe "$output/safari" testPinchSafari "$output/build" || status=$?
  grep -h '^ZOOM' "$output/safari/test.log" | sort -u
  exit "$status"
fi

if [[ $# -ne 4 ]]; then echo 'Usage: zoom.sh SIMULATOR_UDID METRO_PORT METRO_LOG NEW_OUTPUT_DIR | zoom.sh SIMULATOR_UDID control NEW_OUTPUT_DIR' >&2; exit 2; fi
port=$2
log=$3
output=$4
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/pinch" && ! -e "$output/doubletap" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
documents="$(xcrun simctl get_app_container "$simulator" top.xujialiu.openreader data)/Documents"
id=$(node -e 'const l=require(process.argv[1]); const e=l.entries.find((x)=>x.title==="A Short Test of Reading Aloud"); if(!e) process.exit(1); console.log(e.id)' "$documents/library.json") \
  || { echo 'A Short Test of Reading Aloud is not in the Library' >&2; exit 2; }
relaunch() {
  xcrun simctl terminate "$simulator" top.xujialiu.openreader 2>/dev/null || true
  xcrun simctl launch "$simulator" top.xujialiu.openreader -RCT_jsLocation "localhost:$port" > /dev/null
  sleep 8
}
# Waits for Metro's log, past line $1, to report a rendered section.
rendered() {
  for _ in $(seq 1 60); do
    tail -n "+$1" "$log" | grep -q 'HX .*rendered=[0-9]' && return 0
    sleep 0.5
  done
  return 1
}
reacted=0
for method in Pinch DoubleTap; do
  name=$(echo "$method" | tr '[:upper:]' '[:lower:]')
  run="$output/$name"
  mkdir -p "$run"
  relaunch
  from=$(($(wc -l < "$log") + 1))
  node "$source_dir/hx.cjs" "$simulator" "{\"do\":\"open\",\"id\":\"$id\"}" > /dev/null
  rendered "$from" || { echo "ZOOM $name: the Document was never laid out" >&2; exit 2; }
  # A new WebView can still be blank for a second or two (pitfalls/webview.md).
  sleep 3
  probe "$run" "test$method" "$output/build" || { echo "ZOOM $name: the gesture failed, see $run/test.log" >&2; exit 2; }
  # The player's Following mark before and after: a pinch must leave A alone (#79).
  marks=$(grep -h '^ZOOM mark' "$run/test.log" | sort -u | tail -1)
  [[ -n "$marks" ]] || { echo "ZOOM $name: no Following mark in $run/test.log" >&2; exit 2; }
  echo "$marks"
  [[ "$name" != pinch || "$marks" == *"before=A after=A" ]] || reacted=1
  marker="zoom-$name-$$"
  node "$source_dir/hx.cjs" "$simulator" \
    "{\"do\":\"js\",\"code\":\"return '$marker scale='+visualViewport.scale+' innerWidth='+innerWidth+' meta='+document.querySelector('meta[name=viewport]').content\"}" > /dev/null
  answer=''
  # Ten seconds was once not enough after a double tap (2026-09-28 09:54).
  for _ in $(seq 1 60); do
    answer=$(grep -o "$marker[^\"\\\\]*" "$log" | tail -1 || true)
    [[ -n "$answer" ]] && break
    sleep 0.5
  done
  [[ -n "$answer" ]] || { echo "ZOOM $name: no answer in $log" >&2; exit 2; }
  echo "ZOOM $name ${answer#"$marker "}"
  scale=$(echo "$answer" | sed -E 's/^[^ ]* scale=([0-9.]+) .*/\1/')
  [[ "$scale" == 1 ]] || reacted=1
done
relaunch
printf 'Artifacts: %s\n' "$output"
exit "$reacted"
