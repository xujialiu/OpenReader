#!/bin/bash
# A visible-text regression, not an accessibility-label assertion. Open the
# target screen first; never relaunch during the size sweep. No playback.
set -euo pipefail
if (( $# < 4 )); then
  echo 'Usage: dynamic-type.sh UDID OUT_DIR AX_LABEL EXPECTED_VISIBLE_TEXT [MORE_TEXT...]' >&2
  exit 2
fi
udid=$1; out=$2; label=$3; shift 3
root=$(cd "$(dirname "$0")/../../.." && pwd)
mkdir -p "$out"
swiftc "$root/test/manual-test/settings/visible-text.swift" -o "$out/visible-text"
sizes=(extra-small small medium large extra-large extra-extra-large extra-extra-extra-large accessibility-medium accessibility-large accessibility-extra-large accessibility-extra-extra-large accessibility-extra-extra-extra-large)
trap 'xcrun simctl ui "$udid" content_size large' EXIT
for direction in up down; do
  for ((step=0; step<${#sizes[@]}; step++)); do
    index=$step
    if [[ $direction == down ]]; then index=$((${#sizes[@]} - 1 - step)); fi
    size=${sizes[$index]}
    xcrun simctl ui "$udid" content_size "$size"
    sleep 1
    python3 "$root/test/manual-test/kit/ax.py" "$udid" scroll-to "$label"
    shot="$out/$direction-$size.png"
    xcrun simctl io "$udid" screenshot "$shot"
    "$out/visible-text" "$shot" "$@" | tee "$out/$direction-$size.txt"
  done
done
