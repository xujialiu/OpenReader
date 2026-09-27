#!/bin/bash
# Locks or unlocks a simulator, as its side button does.
#
#   bash test/manual-test/lock-device.sh SIMULATOR_UDID lock|unlock
#
# The XCTest is built once into /tmp/openreader-lock-device and then only run
# (test-without-building), so a call takes a few seconds. The last run's log is
# /tmp/openreader-lock-device/ACTION.log. Unlock expects no passcode, which is how
# a simulator is made.
set -euo pipefail
[[ $# -eq 2 && ( $2 == lock || $2 == unlock ) ]] || { echo 'Usage: lock-device.sh SIMULATOR_UDID lock|unlock' >&2; exit 2; }
simulator=$1
action=$2
source_dir=$(cd "$(dirname "$0")" && pwd)
work=/tmp/openreader-lock-device
if [[ ! -d "$work/build/Build/Products" ]]; then
  rm -rf "$work"; mkdir -p "$work"
  ruby "$source_dir/ios/project.rb" "$work" top.xujialiu.openreader NO inspect DeviceLockProbe.swift
  xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
    -destination "id=$simulator" -derivedDataPath "$work/build" build-for-testing > "$work/build.log" 2>&1 \
    || { echo "Build failed: $work/build.log" >&2; exit 1; }
fi
method=testLock; [[ $action == unlock ]] && method=testUnlock
xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$work/build" \
  -only-testing:"LockScreenProbe/DeviceLockProbe/$method" test-without-building > "$work/$action.log" 2>&1 \
  || { echo "XCTest failed: $work/$action.log" >&2; exit 1; }
echo "$action: done"
