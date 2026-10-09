#!/bin/bash
# A Download running across the end of the Trial (#148): it stops at the next
# sentence and is paused, as Pause all pauses it, and the Download drawer then
# shows it Paused: no state line, Resume all, and Resume download rings
# (1.0.0 (7)-beta12; beta11 left it Interrupted).
#
#   bash test/manual-test/purchase/download-across-end.sh SIMULATOR_UDID SECONDS SHOTS_DIR [FAKE_LOG]
#
# Prerequisite, by hand with real touches: a Debug build whose Provider answers
# slowly enough to be under way when the Trial ends (the fake Kokoro server with
# `OPENREADER_FAKE_TTS_DELAY_MS=1000` and the local Provider's one sentence at a
# time gives one sentence a second, `../player-and-reading-held/fake-kokoro.cjs`),
# a Document not yet saved in that voice (a sentence already fetched in this
# process is read from memory and sends nothing, `pitfalls/verification-runs.md`),
# and its Download drawer open with chapters chosen: `Download selected (N)` on
# screen, N read from the tree (the text-less volume page counts).
#
# What it does: sets and checks the simulator's volume, then
# `{"do":"store","state":"trial","seconds":SECONDS}` and a real touch on
# `Download selected (N)`; polls the accessibility tree every 1.5 s until the
# drawer shows Paused, Resume all with no state line (at most 60 s); fails at
# once on Interrupted, beta11's state; takes SHOTS_DIR/download-paused.png
# and prints `DLEND` lines: the Trial's end from the app's own `HX store` line, the
# drawer's state line, its link (Resume all or Pause all) and each chapter's ring
# and count, and, when FAKE_LOG is given, the last synthesis requests' times with
# the end beside them (the fake logs UTC; the Debug Log local time).
#
# It then presses the link (Resume all), prints the alert's words and answers
# Not Now, and prints the drawer again. It does not unlock: send
# `{"do":"store","arrive":"unlock"}` next to see that an Unlock arriving by
# itself resumes nothing; Resume all then goes on with no question.
#
# What it cannot prove: what a phone's continued-processing task does while the
# download is held back (the simulator's answer is `not run`).
set -euo pipefail
[[ $# -ge 3 ]] || { echo 'Usage: download-across-end.sh SIMULATOR_UDID SECONDS SHOTS_DIR [FAKE_LOG]' >&2; exit 2; }
udid=$1; seconds=$2; shots=$3; fake=${4:-}
[[ $seconds =~ ^[0-9]+$ ]] || { echo 'SECONDS must be a whole number' >&2; exit 2; }
kit=$(cd "$(dirname "$0")/../kit" && pwd)
ax() { python3 "$kit/ax.py" "$udid" "$@"; }
container=$(xcrun simctl get_app_container "$udid" top.xujialiu.openreader data)
debug_log() { cat "$container/Library/Application Support/debug-log/"debug-log-*.txt 2>/dev/null || true; }
silent() { bash "$kit/silence.sh" set "$udid" >/dev/null && bash "$kit/silence.sh" check "$udid"; }
mkdir -p "$shots"

tree=$(ax tree)
button=$(echo "$tree" | grep -o 'Download selected ([0-9]*)' | head -1 || true)
[[ -n $button && $button != 'Download selected (0)' ]] || { echo 'DLEND no `Download selected (N)` with N > 0 on screen: open the drawer and choose chapters first' >&2; exit 2; }
echo "DLEND pressing '$button' inside a Trial of $seconds s"
mark=$(debug_log | wc -l | tr -d ' ')

silent && node "$kit/hx.cjs" "$udid" "{\"do\":\"store\",\"state\":\"trial\",\"seconds\":$seconds,\"outcome\":\"purchased\"}" >/dev/null
silent && ax touch "$button"
echo "DLEND button touched $(date +%H:%M:%S.%N | cut -c1-12)"
state=
paused=
for _ in $(seq 1 40); do
  sleep 1.5
  tree=$(ax tree)
  state=$(echo "$tree" | grep -E 'StaticText \| (Interrupted|Queued|Downloading…|Preparing|Selected chapters|Paused)' | head -1 | sed 's/^ *//' || true)
  echo "DLEND $(date +%H:%M:%S.%N | cut -c1-12) ${state:-no state line}"
  [[ $state == *Interrupted* ]] && { echo 'DLEND Interrupted: the lock left the download Interrupted, not Paused (beta11)' >&2; exit 1; }
  # Paused has no state line of its own (download-sheet.tsx): Resume all, with
  # no running state beside it, is what shows it.
  if ! echo "$tree" | grep -qE 'StaticText \| (Queued|Downloading…|Preparing)' && echo "$tree" | grep -q 'Resume all'; then paused=yes; break; fi
done
[[ -n $paused ]] || { echo 'DLEND never reached Paused: the Trial may be too long for this Provider, or the download finished first' >&2; exit 1; }
xcrun simctl io "$udid" screenshot "$shots/download-paused.png" >/dev/null 2>&1 && echo "DLEND screenshot $shots/download-paused.png"

ends=$(debug_log | tail -n +$((mark + 1)) | grep -o '"endsAt":[0-9]*' | tail -1 | cut -d: -f2 || true)
end_local=$(python3 -c "import datetime; print(datetime.datetime.fromtimestamp($ends/1000).strftime('%H:%M:%S.%f')[:-3])")
end_utc=$(python3 -c "import datetime; print(datetime.datetime.fromtimestamp($ends/1000, datetime.timezone.utc).strftime('%H:%M:%S.%f')[:-3])")
echo "DLEND the Trial ended at $end_local local ($end_utc UTC)"
echo "DLEND the drawer's lines:"
echo "$tree" | sed 's/^ *//' | grep -E 'chapters downloaded|Interrupted|Queued|Resume all|Pause all|Resume download|Pause download| / [0-9]+ \|' | awk '!seen[$0]++' | sed 's/^/DLEND   /'
if [[ -n $fake && -f $fake ]]; then
  echo "DLEND the last synthesis requests of $fake (UTC), the Trial's end at $end_utc:"
  grep 'text=' "$fake" | tail -4 | cut -c1-110 | sed 's/^/DLEND   /'
fi

echo "DLEND pressing the link with the Trial over:"
silent && ax touch "Resume all"
sleep 1
ax alert | sed 's/^/DLEND   /' || true
ax alert-touch "Not Now" >/dev/null || true
sleep 2
after=$(ax tree)
echo "DLEND after Not Now: $(echo "$after" | grep -E 'StaticText \| (Interrupted|Queued|Downloading…)' | head -1 | sed 's/^ *//' || true) $(echo "$after" | grep -o 'Resume all\|Pause all' | head -1 || true)"
