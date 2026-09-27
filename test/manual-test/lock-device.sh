#!/bin/bash
# Locks or unlocks a simulator, as its side button does, or presses the lock
# screen's own Now Playing Play or Pause while the device stays locked.
#
#   bash test/manual-test/lock-device.sh SIMULATOR_UDID lock|unlock|play|pause
#
# The XCTest is built once into /tmp/openreader-lock-device and then only run
# (test-without-building), so a call takes a few seconds. The last run's log is
# /tmp/openreader-lock-device/ACTION.log. Unlock expects no passcode, which is how
# a simulator is made. play and pause wake a dark screen with one Home press and
# fail unless the centre button reads Play (or Pause) and then turns; play checks
# the simulator's volume is zero first. A build made before play and pause
# existed lacks them: delete /tmp/openreader-lock-device to rebuild it.
set -euo pipefail
[[ $# -eq 2 && ( $2 == lock || $2 == unlock || $2 == play || $2 == pause ) ]] || { echo 'Usage: lock-device.sh SIMULATOR_UDID lock|unlock|play|pause' >&2; exit 2; }
simulator=$1
action=$2
source_dir=$(cd "$(dirname "$0")" && pwd)
[[ $action == play ]] && { bash "$source_dir/silence.sh" check "$simulator" || exit 2; }
work=/tmp/openreader-lock-device
if [[ ! -d "$work/build/Build/Products" ]]; then
  rm -rf "$work"; mkdir -p "$work"
  ruby "$source_dir/ios/project.rb" "$work" top.xujialiu.openreader NO inspect DeviceLockProbe.swift
  xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
    -destination "id=$simulator" -derivedDataPath "$work/build" build-for-testing > "$work/build.log" 2>&1 \
    || { echo "Build failed: $work/build.log" >&2; exit 1; }
fi
case $action in
  lock) method=testLock ;; unlock) method=testUnlock ;;
  play) method=testLockScreenPlay ;; pause) method=testLockScreenPause ;;
esac
xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$work/build" \
  -only-testing:"LockScreenProbe/DeviceLockProbe/$method" test-without-building > "$work/$action.log" 2>&1 \
  || { echo "XCTest failed: $work/$action.log" >&2; exit 1; }
echo "$action: done"
