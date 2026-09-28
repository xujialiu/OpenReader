#!/bin/bash
# Two-finger drags against Files (the phone's own selection, measured) or the
# download drawer (ours), through TwoFingerProbe (#57). The Files methods need
# the staged rows: `two-finger.sh SIMULATOR_UDID stage` puts 60 small files in
# On My iPhone › Rows first. Every other call is kit/run-probe.sh TwoFingerProbe
# with Files as the target bundle.
set -euo pipefail
if [[ $# -lt 2 ]]; then echo 'Usage: two-finger.sh SIMULATOR_UDID stage | two-finger.sh SIMULATOR_UDID OUTPUT_DIR -only-testing:TwoFingerProbe/testName' >&2; exit 2; fi
simulator=$1
if [[ $2 == stage ]]; then
  group=$(xcrun simctl get_app_container "$simulator" com.apple.DocumentsApp groups | awk -F'\t' '$1 == "group.com.apple.FileProvider.LocalStorage" { print $2 }')
  [[ -n "$group" ]] || { echo 'Files has no local storage yet: launch Files once, then stage' >&2; exit 2; }
  mkdir -p "$group/File Provider Storage/Rows"
  for i in $(seq -w 1 60); do printf 'row %s\n' "$i" > "$group/File Provider Storage/Rows/Row $i.txt"; done
  echo "Staged 60 rows in $group/File Provider Storage/Rows"
  exit 0
fi
output=$2
shift 2
exec bash "$(cd "$(dirname "$0")" && pwd)/../kit/run-probe.sh" TwoFingerProbe "$simulator" "$output" --bundle com.apple.DocumentsApp "$@"
