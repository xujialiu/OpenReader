#!/bin/bash
# Locks or unlocks a simulator, as its side button does, or presses the lock
# screen's own Now Playing Play or Pause while the device stays locked.
#
#   bash test/manual-test/kit/lock-device.sh SIMULATOR_UDID lock|unlock|play|pause|play-refused|home
#   bash test/manual-test/kit/lock-device.sh SIMULATOR_UDID lock-on|home-on SIGNAL_FILE
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
# passcode, which is how a simulator is made. play and pause wake a dark screen
# with one Home press and fail unless the centre button reads Play (or Pause)
# and then turns; play checks the simulator's volume is zero first. play-refused
# is for a Play the app refuses (#148): it asserts only that the button reads
# Play, taps it, and prints `LOCKPROBE label …` when the tap returns and 2 s
# later (`play` fails there once the app puts the button back, and a failed run
# leaves xcodebuild in `simctl diagnose` for minutes). home and
# home-on press Home instead of the lock button (XCUIDevice's own press; `axe
# button home` did nothing on iOS 27.0), home-on waiting for SIGNAL_FILE as
# lock-on does, with its log in /tmp/openreader-lock-device/home-on.log.
# OPENREADER_LOCK_DEVICE_WORK names another build directory (default
# /tmp/openreader-lock-device), which every session shares and this script
# deletes and rebuilds when its checkout's DeviceLockProbe.swift is newer: set it
# to a directory of your own so a run in one worktree never removes the build
# another session's run is using (pitfalls/lock-and-background.md).
set -euo pipefail
[[ ( $# -eq 2 && ( $2 == lock || $2 == unlock || $2 == play || $2 == pause || $2 == play-refused || $2 == home ) ) || ( $# -eq 3 && ( $2 == lock-on || $2 == home-on ) ) ]] \
  || { echo 'Usage: lock-device.sh SIMULATOR_UDID lock|unlock|play|pause|play-refused|home | lock-device.sh SIMULATOR_UDID lock-on|home-on SIGNAL_FILE' >&2; exit 2; }
simulator=$1
action=$2
source_dir=$(cd "$(dirname "$0")" && pwd)
[[ $action == play || $action == play-refused ]] && { bash "$source_dir/silence.sh" check "$simulator" || exit 2; }
work=${OPENREADER_LOCK_DEVICE_WORK:-/tmp/openreader-lock-device}
if [[ ! -d "$work/build/Build/Products" || "$source_dir/DeviceLockProbe.swift" -nt "$work/build/Build/Products" ]]; then
  rm -rf "$work"; mkdir -p "$work"
  ruby "$source_dir/project.rb" "$work" top.xujialiu.openreader NO inspect DeviceLockProbe.swift
  xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
    -destination "id=$simulator" -derivedDataPath "$work/build" build-for-testing > "$work/build.log" 2>&1 \
    || { echo "Build failed: $work/build.log" >&2; exit 1; }
  touch "$work/build/Build/Products"
fi
case $action in
  lock) method=testLock ;; unlock) method=testUnlock ;;
  play) method=testLockScreenPlay ;; pause) method=testLockScreenPause ;; play-refused) method=testLockScreenPlayRefused ;;
  lock-on) method=testLockOnSignal; rm -f "$3" ;;
  home) method=testHome ;; home-on) method=testHomeOnSignal; rm -f "$3" ;;
esac
TEST_RUNNER_LOCK_SIGNAL=${3:-} xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$work/build" \
  -only-testing:"LockScreenProbe/DeviceLockProbe/$method" test-without-building > "$work/$action.log" 2>&1 \
  || { echo "XCTest failed: $work/$action.log" >&2; exit 1; }
echo "$action: done"
