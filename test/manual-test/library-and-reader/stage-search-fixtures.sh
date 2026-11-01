#!/bin/bash
# Stages the Library Search fixtures of library-search.md (#332, #339) through the walkthrough harness:
# `A Short Test of Reading Aloud` first (the oldest row), then `Scroll Diag 01 of 12` .. `12 of 12`, 1.6 s
# apart, then a no-op so that a relaunch replays nothing (pitfalls/verification-runs.md, #95).
#
#   bash test/manual-test/library-and-reader/stage-search-fixtures.sh SIMULATOR_UDID OUTPUT_DIR
#
# Prerequisites: the Debug app running on SIMULATOR_UDID (only a Debug Mode build polls `harness.json`) and
# a Library that holds none of these Documents, which this script never deletes. A Library left by
# another run (`Scroll Diag … of 14`, Flick Folders) is emptied through the app first, `…` > Select >
# Select all > Delete selected > Delete (the alert says how many documents and folders). The books come
# from `make-list-books.py` and `fixtures/short-test-fixture.ts` into OUTPUT_DIR, so a Library staged
# here is the same one every time. The Folder `Search Folder`, which holds the short test, is made with
# the probe afterwards: `run-probe.sh LibrarySearchProbe … -only-testing:LibrarySearchProbe/testStageFolderAndMoveFixture`.
#
# Expected: 13 entries in `Documents/library.json`, the last line `staged 13 entries`; exit 1 if the app
# did not import all of them within 15 s after the last command. It cannot prove that a book opens: each
# is one short chapter.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'Usage: stage-search-fixtures.sh SIMULATOR_UDID OUTPUT_DIR' >&2; exit 2; }
UDID=$1
OUT=$2
cd "$(dirname "$0")/../../.."
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
rm -rf "$OUT/fixtures" && mkdir -p "$OUT/fixtures/long" "$OUT/fixtures/short"
python3 -I test/manual-test/library-and-reader/make-list-books.py "$OUT/fixtures/long" "Scroll Diag" 12
npx tsx test/manual-test/fixtures/short-test-fixture.ts "$OUT/fixtures/short"
# The container path changes at every install: resolve it now, never keep it from earlier.
DATA=$(xcrun simctl get_app_container "$UDID" top.xujialiu.openreader data)
INBOX="$DATA/Documents/Inbox"
mkdir -p "$INBOX"
cp "$OUT"/fixtures/long/*.epub "$OUT"/fixtures/short/*.epub "$INBOX/"
command_seq=$(date +%s)
send() {
  command_seq=$((command_seq + 1))
  printf '{"seq":%d,"do":"add","file":"%s"}' "$command_seq" "$1" > "$DATA/Documents/harness.json"
  echo "sent $command_seq $1 $(date +%T)"
  sleep 1.6
}
send "A Short Test of Reading Aloud.epub"
for i in 01 02 03 04 05 06 07 08 09 10 11 12; do send "Scroll Diag $i of 12.epub"; done
command_seq=$((command_seq + 1))
printf '{"seq":%d,"do":"noop"}' "$command_seq" > "$DATA/Documents/harness.json"
count() { python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['entries']))" "$DATA/Documents/library.json"; }
for _ in $(seq 1 15); do
  [[ $(count) -ge 13 ]] && break
  sleep 1
done
echo "staged $(count) entries"
[[ $(count) -eq 13 ]]
