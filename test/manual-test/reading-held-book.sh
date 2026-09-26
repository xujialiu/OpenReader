#!/bin/bash
# Real touches for #68 against a real, long book (ios/ReadingHeldBookProbe.swift):
# leaving near the edge of what a fresh mount had rendered while playing, and
# returning after the voice crosses into a section the parked page had not
# yet laid out.
#
# Expects "Shadow Slave — Chapters 1–250" already in the Library (README,
# "Real books"). A fresh mount's own Utterance count (`known`, from the
# harness `say`) is session-relative — the same absolute number means a
# different place after a different resume anchor (test/manual-test/README.md
# Pitfalls, "A real book's Utterance index is session-relative, not
# book-absolute"). So before the real-touch suite runs, this script opens the
# book and re-derives the target from THIS session's own `known`, MARGIN
# Utterances short of it (default 6 — measured 2026-09-26 as clear of the
# render trigger; see the same Pitfall), by the harness's own `open`/`say`/
# `seek` commands (a handler action, not a touch: reaching a chosen sentence
# in a 250-chapter book by real taps alone is impractical), and confirms the
# seek did not itself trigger the next section's render before retrying with
# a larger margin. It leaves the app sitting in that live, paused reader —
# it does NOT leave and reopen the book, because leaving while paused did not
# reliably persist a harness seek to the saved place in testing (same
# Pitfall) — and the probe's own first touch is Play, not a tap to reopen.
set -euo pipefail
if [[ $# -lt 3 ]]; then echo 'Usage: reading-held-book.sh SIMULATOR_UDID NEW_OUTPUT_DIR METRO_LOG [MARGIN]' >&2; exit 2; fi
simulator=$1
output=$2
metro_log=$3
margin=${4:-6}
source_dir=$(cd "$(dirname "$0")" && pwd)
bash "$source_dir/silence.sh" check "$simulator" || exit 2
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
[[ -f "$metro_log" ]] || { echo "No such Metro log: $metro_log" >&2; exit 2; }

data=$(xcrun simctl get_app_container "$simulator" top.xujialiu.openreader data)
book_id=$(python3 -c "
import json,sys
lib=json.load(open('$data/Documents/library.json'))
for e in lib['entries']:
    if e['title'].startswith('Shadow Slave'):
        print(e['id']); sys.exit(0)
sys.exit(1)
") || { echo 'Shadow Slave — Chapters 1–250 is not in the Library' >&2; exit 2; }

seq=500000
send() { seq=$((seq+1)); printf '{"seq":%s,%s}\n' "$seq" "$1" > "$data/Documents/harness.json"; }
# Prints the freshest `HX status ` line after sending `say`, or nothing if
# none arrives within 8s (the app can be mid-navigation and briefly miss a
# poll cycle — never treated as fatal here; callers retry).
say_status() {
  local offset line
  offset=$(wc -c < "$metro_log")
  send '"do":"say"'
  local waited=0
  while (( waited < 15000 )); do
    sleep 0.5; waited=$((waited+500))
    line=$(tail -c +"$((offset+1))" "$metro_log" | grep 'HX status ' | tail -1) || true
    [[ -n "$line" ]] && break
  done
  echo "$line"
}
# Under `set -e -o pipefail`, an unmatched grep (a blank/short status line —
# expected whenever say_status times out) fails the whole pipeline and, with
# no `|| true`, silently kills the script with no message at all (measured
# 2026-09-26, README Pitfalls, "field() with no `|| true` silently killed the
# real-book seeding script"). Always exit 0; callers already treat an empty
# result as "keep retrying".
field() { echo "$1" | grep -oE "$2=[^ ]+" | head -1 | cut -d= -f2 || true; }

# Collapse whatever screen stack is currently on top, then open the book fresh.
for _ in 1 2; do send '"do":"shut"'; sleep 1; done
send "\"do\":\"open\",\"id\":\"$book_id\""
sleep 6
# A big book's first section can still be laying out a few seconds in — a
# fresh mount briefly answers `known=0`, and the JS thread laying out several
# spine sections of a 250-chapter book can be too busy to answer the harness
# poll at all for a few seconds (measured 2026-09-26, README Pitfalls); poll
# rather than trust one snapshot.
known=0
for _ in 1 2 3 4 5 6; do
  status_line=$(say_status)
  read_known=$(field "$status_line" known)
  [[ "$read_known" =~ ^[0-9]+$ ]] || { sleep 2; continue; }
  known=$read_known
  (( known > 0 )) && break
  sleep 2
done
(( known > 0 )) || { echo "No usable 'known' after opening $book_id (last status: $status_line)" >&2; exit 2; }
attempt=0
target=$((known - margin))
while :; do
  attempt=$((attempt+1))
  (( target > 0 )) || { echo "Margin $margin left no room in known=$known" >&2; exit 2; }
  send "\"do\":\"seek\",\"utterance\":$target"
  # The app polls harness.json every 250ms; without this, the immediate `say`
  # inside say_status can overwrite the file before the seek is ever read,
  # and the "known" reported back is then still the pre-seek value (silently
  # dropped seek — test/manual-test/README.md Pitfalls).
  sleep 0.6
  new_known=
  for _ in 1 2 3; do
    status_line=$(say_status)
    candidate=$(field "$status_line" known)
    [[ "$candidate" =~ ^[0-9]+$ ]] && { new_known=$candidate; break; }
    sleep 1
  done
  [[ -n "$new_known" ]] || { echo "No usable 'known' after seeking to $target (last status: $status_line)" >&2; exit 2; }
  if [[ "$new_known" == "$known" ]]; then break; fi
  (( attempt < 4 )) || { echo "The seek kept triggering a fresh render after $attempt attempts" >&2; exit 2; }
  echo "seek to $target triggered a render (known $known -> $new_known); retrying with a larger margin" >&2
  known=$new_known
  target=$((known - margin))
done
playing=$(field "$status_line" playing)
if [[ "$playing" != "false" ]]; then
  echo "Expected the seeded reader paused, status: $status_line" >&2
  exit 2
fi
printf 'Seeded live (not persisted): known=%s target utterance=%s (margin %s)\nstatus: %s\n' "$known" "$target" "$margin" "$status_line"

ruby "$source_dir/ios/project.rb" "$output" top.xujialiu.openreader NO inspect ReadingHeldBookProbe.swift
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" \
  -only-testing:LockScreenProbe/ReadingHeldBookProbe/testRealBookCrossesUnrenderedSectionWhileParked \
  test > "$output/test.log" 2>&1 &
build=$!
finished=
while kill -0 "$build" 2>/dev/null; do
  if [[ -z $finished ]] && grep -q "Test Suite '\(Selected\|All\) tests' \(passed\|failed\)" "$output/test.log" 2>/dev/null; then finished=$SECONDS; fi
  if [[ -n $finished ]] && (( SECONDS - finished > 120 )); then kill "$build" 2>/dev/null || true; echo 'xcodebuild outlived its tests by 120 s and was stopped' >&2; break; fi
  sleep 2
done
wait "$build" || status=$?
if grep -q "Test Suite '\(Selected\|All\) tests' failed" "$output/test.log"; then status=1
elif grep -q "Test Suite '\(Selected\|All\) tests' passed" "$output/test.log"; then status=0; fi
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments" \
    || echo 'Attachments not exported: see result.xcresult/Data/data.*' >&2
fi
grep -h 'Executed \|error:\|ROW ' "$output/test.log" | sort -u || true
printf 'Artifacts: %s\n' "$output"
exit "$status"
