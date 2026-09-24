#!/bin/bash
# #29: is every hairline in the drawers and the player drawn in the theme's own
# line colour? Sets the app's theme, photographs each drawer as the owner opens
# it (LineColourProbe.swift), and reads every line's colour (line-colour.py).
#
#   bash test/manual-test/line-colour.sh SIMULATOR_UDID NEW_OUTPUT_DIR light|dark|system [PHONE_APPEARANCE]
#
# PHONE_APPEARANCE (light|dark) is the simulator's own appearance for the run;
# left out, the simulator keeps the one it has. The mismatched pair — the app
# forced to one theme on a phone set to the other — is the case #29 was seen in.
# `system` is the app following the phone, whose lines should then be the
# phone's.
# Puts back the theme and the simulator's appearance it found. Needs
# `A Short Test of Reading Aloud` in the Library, the Library on screen and this
# tree's Metro serving the app (the theme is set through the walkthrough
# harness). Plays nothing.
#
# Exit 1 = RED (a line in the other theme's colour), 0 = GREEN, other = the
# probe itself failed, so the screenshots may not show the drawers.
set -euo pipefail
if [[ $# -lt 3 ]]; then echo 'Usage: line-colour.sh SIMULATOR_UDID NEW_OUTPUT_DIR light|dark|system [light|dark]' >&2; exit 2; fi
simulator=$1
output=$2
theme=$3
phone=${4:-}
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
data=$(xcrun simctl get_app_container "$simulator" top.xujialiu.openreader data)
harness="$data/Documents/harness.json"
seq=$(( $(date +%s) % 1000000 * 10 ))
hx() {
  seq=$((seq + 1))
  python3 -c 'import json,sys,os; c=json.loads(sys.argv[1]); c["seq"]=int(sys.argv[2]); open(sys.argv[3]+".tmp","w").write(json.dumps(c)); os.replace(sys.argv[3]+".tmp", sys.argv[3])' "$1" "$seq" "$harness"
  sleep "${2:-1}"
}
was_theme=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["settings"]["theme"])' "$data/Documents/settings.json")
was_phone=$(xcrun simctl ui "$simulator" appearance)
restore() {
  hx "{\"do\":\"settings\",\"patch\":{\"theme\":\"$was_theme\"}}" 1
  rm -f "$harness"
  xcrun simctl ui "$simulator" appearance "$was_phone"
}
trap restore EXIT
[[ -z "$phone" ]] || xcrun simctl ui "$simulator" appearance "$phone"
lines=$theme
[[ $theme != system ]] || lines=$(xcrun simctl ui "$simulator" appearance)
hx "{\"do\":\"settings\",\"patch\":{\"theme\":\"$theme\"}}" 2
hx '{"do":"shut"}' 1
hx '{"do":"shut"}' 2
ruby "$source_dir/ios/project.rb" "$output" top.xujialiu.openreader NO inspect LineColourProbe.swift
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" -collect-test-diagnostics never \
  -only-testing:LockScreenProbe/LineColourProbe/testPhotographDrawers \
  test > "$output/test.log" 2>&1 || status=$?
xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments" > /dev/null 2>&1 || true
# Exported attachments are named by UUID; give each screenshot the name the probe gave it.
python3 - "$output/attachments" <<'PY' || true
import json, os, sys
os.chdir(sys.argv[1])
for test in json.load(open('manifest.json')):
    for a in test['attachments']:
        name = a['suggestedHumanReadableName']
        if name.endswith('.png'):
            os.replace(a['exportedFileName'], name.split('_0_')[0] + '.png')
PY
printf 'Artifacts: %s\n' "$output"
[[ $status -eq 0 ]] || { echo "The probe failed ($status): see $output/test.log" >&2; exit 3; }
python3 "$source_dir/line-colour.py" "$lines" "$output"/attachments/*.png
