#!/bin/bash
set -euo pipefail
if [[ $# != 2 ]]; then
  echo 'Usage: check-media-resources.sh SIMULATOR_UDID OUTPUT_DIR' >&2
  exit 2
fi
simulator=$1
mkdir -p "$2"
output=$(cd "$2" && pwd)
source_dir=$(cd "$(dirname "$0")" && pwd)
runtime=$(xcrun simctl getenv "$simulator" SIMULATOR_ROOT)
xcrun --sdk iphonesimulator clang -arch "$(uname -m)" -mios-simulator-version-min=16.4 \
  -framework Foundation -framework QuartzCore "$source_dir/ios/check-media-resources.m" \
  -o "$output/check-media-resources"
xcrun simctl spawn "$simulator" "$output/check-media-resources" \
  "$runtime/System/Library/PrivateFrameworks/MediaControls.framework/PlayPauseStop.ca"
