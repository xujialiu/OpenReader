#!/bin/bash
# A white flash on the dark reading page (#27): record the screen through one
# trigger and read every frame with white-flash.py.
#
#   bash test/manual-test/scrolling-and-theme/white-flash.sh open     SIMULATOR_UDID DOC_ID OUT_DIR [RUNS]
#   bash test/manual-test/scrolling-and-theme/white-flash.sh relaunch SIMULATOR_UDID DOC_ID OUT_DIR METRO_LOG PORT [RUNS]
#   bash test/manual-test/scrolling-and-theme/white-flash.sh fling    SIMULATOR_UDID DOC_ID OUT_DIR [RUNS]
#
# open      from the Library, open the Document once per run.
# relaunch  restart the app first (a fresh ReaderProvider, so the first open
#           after a launch), wait until its JavaScript answers the harness, then
#           open. METRO_LOG is this tree's Metro output; PORT its port, passed to
#           the relaunch as -RCT_jsLocation.
#           TAP=1 opens with a real XCTest tap on the Library row
#           (ScrollThemeReaderProbe.testRealTapOpenForRecording) instead of the
#           harness, which is the owner's own trigger; BOOK_TITLE names the row
#           (default "My Vampire System"), DOC_ID is then unused.
# fling     open, let it settle, then FLINGS (default 15) real fast swipes each
#           way through ScrollThemeReaderProbe.testLongFlingForRecording.
#           PAINT=1 first paints the WebView's page magenta and epub.js's scroll
#           container green, so a flash shows which layer it is.
#
# Needs the app theme set to dark and the reader's harness. Never plays; the
# XCTest runs still refuse a simulator whose own volume is not zero
# (kit/run-probe.sh). A run whose XCTest failed is reported as such and
# its recording is not read: there was nothing in it to read.
# Exit 1 when any run is RED, 2 when any run's XCTest failed.
set -u
if [[ $# -lt 4 ]]; then sed -n '4,6p' "$0" >&2; exit 2; fi
mode=$1; udid=$2; doc=$3; out=$4; shift 4
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
if [[ $mode == relaunch ]]; then log=$1; port=$2; shift 2; fi
runs=${1:-1}
[[ -n ${BOOK_TITLE:-} ]] && export TEST_RUNNER_BOOK_TITLE="$BOOK_TITLE"
harness="$(xcrun simctl get_app_container "$udid" top.xujialiu.openreader data)/Documents/harness.json"
# Every command needs a new seq (README Pitfalls); milliseconds always are.
send() { python3 -c 'import json, sys, time; json.dump(dict(json.loads(sys.argv[2]), seq=int(time.time() * 1000)), open(sys.argv[1], "w"))' "$harness" "$1"; }
record() { xcrun simctl io "$udid" recordVideo --codec h264 --force "$1" > /dev/null 2>&1 & recorder=$!; sleep 1.2; }
stop() { kill -INT "$recorder"; wait "$recorder" 2>/dev/null; }
# One XCTest method against the running app; false when it failed or was refused.
probe() { bash "$here/../kit/run-probe.sh" ScrollThemeReaderProbe "$udid" "$out/xctest" "-only-testing:$1" > "$2" 2>&1; }

status=0
for run in $(seq 1 "$runs"); do
  video="$out/$mode-$run.mp4"
  ran=true
  case $mode in
    open|relaunch)
      # Shut first either way, so a relaunch comes back to the Library.
      send '{"do":"shut"}'; sleep 1.5
      if [[ $mode == relaunch ]]; then
        xcrun simctl terminate "$udid" top.xujialiu.openreader 2>/dev/null
        rm -f "$harness"
        xcrun simctl launch "$udid" top.xujialiu.openreader -RCT_jsLocation "localhost:$port" > /dev/null
        from=$(( $(wc -l < "$log") + 1 ))
        for _ in $(seq 1 80); do
          send '{"do":"shelf"}'; sleep 0.25
          tail -n +"$from" "$log" | grep -q 'HX shelf loading=false' && break
        done
      fi
      record "$video"
      if [[ -n ${TAP:-} ]]; then
        probe testRealTapOpenForRecording "$out/$mode-$run.log" || ran=false
      else
        send "{\"do\":\"open\",\"id\":\"$doc\"}"
        sleep 7
      fi
      stop ;;
    fling)
      send '{"do":"shut"}'; sleep 1.5
      send "{\"do\":\"open\",\"id\":\"$doc\"}"; sleep 10
      if [[ -n ${PAINT:-} ]]; then
        send '{"do":"js","code":"document.documentElement.style.background=document.body.style.background=document.getElementById(\"viewer\").style.background=\"#ff00ff\";rendition.manager.container.style.background=\"#00ff00\";return \"painted\";"}'
        sleep 1.5
      fi
      record "$video"
      TEST_RUNNER_FLINGS=${FLINGS:-15} probe testLongFlingForRecording "$out/$mode-$run.log" || ran=false
      sleep 0.5
      stop ;;
    *) sed -n '4,6p' "$0" >&2; exit 2 ;;
  esac
  if [[ $ran == false ]]; then
    echo "$mode $run: XCTest failed, recording not read: $out/$mode-$run.log"
    status=2
    continue
  fi
  printf '%s %s: ' "$mode" "$run"
  python3 "$here/white-flash.py" "$video" ${VERBOSE:+-v} | tail -1
  [[ ${PIPESTATUS[0]} -eq 1 && $status -eq 0 ]] && status=1
done
exit "$status"
