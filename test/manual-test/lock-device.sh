#!/bin/bash
# Locks or unlocks a simulator, as its side button does.
#
#   bash test/manual-test/lock-device.sh SIMULATOR_UDID lock|unlock
#   bash test/manual-test/lock-device.sh SIMULATOR_UDID lock-on SIGNAL_FILE
#
# The XCTest is built once into /tmp/openreader-lock-device, and again whenever
# DeviceLockProbe.swift is newer than that build, and then only run
# (test-without-building). A plain lock presses the button about 20 s after the
# call, near the end of the runner's launch. `lock-on` waits instead: start it
# in the background, wait for `LOCKPROBE waiting for SIGNAL_FILE` in
# /tmp/openreader-lock-device/lock-on.log (an earlier run's log says it too),
# then create SIGNAL_FILE, and the lock button is pressed within about 0.05 s;
# the log's `LOCKPROBE pressing at` is that moment in Unix seconds. The last
# run's log is /tmp/openreader-lock-device/ACTION.log. Unlock expects no
# passcode, which is how a simulator is made.
set -euo pipefail
[[ ( $# -eq 2 && ( $2 == lock || $2 == unlock ) ) || ( $# -eq 3 && $2 == lock-on ) ]] \
  || { echo 'Usage: lock-device.sh SIMULATOR_UDID lock|unlock | lock-device.sh SIMULATOR_UDID lock-on SIGNAL_FILE' >&2; exit 2; }
simulator=$1
action=$2
source_dir=$(cd "$(dirname "$0")" && pwd)
work=/tmp/openreader-lock-device
if [[ ! -d "$work/build/Build/Products" || "$source_dir/ios/DeviceLockProbe.swift" -nt "$work/build/Build/Products" ]]; then
  rm -rf "$work"; mkdir -p "$work"
  ruby "$source_dir/ios/project.rb" "$work" top.xujialiu.openreader NO inspect DeviceLockProbe.swift
  xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
    -destination "id=$simulator" -derivedDataPath "$work/build" build-for-testing > "$work/build.log" 2>&1 \
    || { echo "Build failed: $work/build.log" >&2; exit 1; }
  touch "$work/build/Build/Products"
fi
method=testLock
[[ $action == unlock ]] && method=testUnlock
[[ $action == lock-on ]] && { method=testLockOnSignal; rm -f "$3"; }
TEST_RUNNER_LOCK_SIGNAL=${3:-} xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$work/build" \
  -only-testing:"LockScreenProbe/DeviceLockProbe/$method" test-without-building > "$work/$action.log" 2>&1 \
  || { echo "XCTest failed: $work/$action.log" >&2; exit 1; }
echo "$action: done"
