#!/bin/bash
set -euo pipefail
if [[ $# -lt 2 || $# -gt 5 ]]; then
  echo 'Usage: lock-screen.sh SIMULATOR_UDID OUTPUT_DIR [APP_BUNDLE_ID] [YES|NO expect player] [inspect|tap]' >&2
  exit 2
fi
simulator=$1
output=$2
bundle=${3:-top.xujialiu.openreader}
expect_player=${4:-YES}
mode=${5:-inspect}
if [[ "$mode" != inspect && "$mode" != tap ]]; then echo 'Mode must be inspect or tap' >&2; exit 2; fi
if [[ "$mode" == tap ]]; then
  # Host output is a second silence guard; also mute the simulator before testing.
  [[ $(osascript -e 'output volume of (get volume settings)') == 0 ]] || { echo 'Mute machine output before transport tests' >&2; exit 2; }
fi
source_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$output"
output=$(cd "$output" && pwd)
if [[ -e "$output/result.xcresult" ]]; then
  echo 'Choose a new output directory; result.xcresult already exists.' >&2
  exit 2
fi
ruby "$source_dir/ios/project.rb" "$output" "$bundle" "$expect_player" "$mode"
status=0
xcodebuild -project "$output/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$output/build" \
  -resultBundlePath "$output/result.xcresult" test > "$output/test.log" 2>&1 || status=$?
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments"
fi
printf 'Artifacts: %s\n' "$output"
exit "$status"
