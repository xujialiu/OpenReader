#!/bin/bash
# The Download drawer beside a Reading (#75): DownloadBesideReadingProbe, one
# method per call, on an app that is already running (it is never relaunched).
#
#   bash test/manual-test/downloads/download-drawer.sh SIMULATOR_UDID NEW_OUTPUT_DIR METHOD
#
# METHOD: testOpenDrawer (the Reader in front), testReadDrawer (drawer open:
# state line, rings, two screenshots 3 s apart, then Close Download),
# testRingThenPauseAllAndResumeAll (drawer open with a ring reading Pause
# download on screen; leaves the download paused by Pause all and the drawer
# closed). Nothing here plays or pauses the Reading, so a call can sit between
# two steps of a timed run: the probe is built once into
# /tmp/openreader-download-drawer (again when the Swift file is newer), and a
# call then takes about 10 s. Artifacts: NEW_OUTPUT_DIR/test.log, result.xcresult,
# attachments/.
#
# SCROLL_TO=CHAPTER_ID scrolls the open drawer's list to that chapter first, a
# handler through cdp.cjs (OPENREADER_METRO, 127.0.0.1), not a touch: a ring far
# down a long book is not rendered, and FlatList's scrollToIndex refuses a row
# it has not measured (Pitfalls, cdp.md), so scrollToEnd is repeated until it can.
set -euo pipefail
if [[ $# -ne 3 ]]; then echo 'Usage: download-drawer.sh SIMULATOR_UDID NEW_OUTPUT_DIR METHOD' >&2; exit 2; fi
simulator=$1
output=$2
method=$3
source_dir=$(cd "$(dirname "$0")" && pwd)
work=/tmp/openreader-download-drawer
if [[ ! -d "$work/build/Build/Products" || "$source_dir/DownloadBesideReadingProbe.swift" -nt "$work/build.log" ]]; then
  rm -rf "$work"; mkdir -p "$work"
  ruby "$source_dir/../kit/project.rb" "$work" top.xujialiu.openreader NO inspect DownloadBesideReadingProbe.swift
  xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
    -destination "id=$simulator" -derivedDataPath "$work/build" build-for-testing > "$work/build.log" 2>&1 \
    || { echo "Build failed: $work/build.log" >&2; exit 1; }
fi
mkdir -p "$output"
output=$(cd "$output" && pwd)
[[ ! -e "$output/result.xcresult" ]] || { echo 'Use a new artifact directory' >&2; exit 2; }
if [[ -n ${SCROLL_TO:-} ]]; then
  cat > "$output/scroll.js" <<JS
(() => { let found; const walk = (f, inside) => { if (!f) return; const name = f.type && (f.type.displayName || f.type.name); const here = inside || name === 'DownloadContent'; if (here && name === 'FlatList' && f.stateNode && f.stateNode.scrollToIndex) found = f.stateNode; walk(f.child, here); walk(f.sibling, inside); };
const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__; hook.renderers.forEach((_, id) => hook.getFiberRoots(id).forEach((root) => walk(root.current, false)));
if (!found) return 'no list'; const i = found.props.data.findIndex((c) => c.id === '$SCROLL_TO'); if (i < 0) return 'no such chapter';
try { found.scrollToIndex({ index: i, animated: false, viewPosition: 0.3 }); return 'at index ' + i; } catch (e) { found.scrollToEnd({ animated: false }); return 'end'; } })()
JS
  scrolled=''
  for _ in $(seq 1 25); do
    scrolled=$(node "$source_dir/../kit/cdp.cjs" --eval "$output/scroll.js" || true)
    [[ $scrolled == *'at index'* || $scrolled == *'no '* ]] && break
    sleep 0.3
  done
  echo "scroll to $SCROLL_TO: $scrolled"
  [[ $scrolled == *'at index'* ]] || exit 1
fi
status=0
xcodebuild -project "$work/ManualTests.xcodeproj" -scheme LockScreenProbe \
  -destination "id=$simulator" -derivedDataPath "$work/build" \
  -resultBundlePath "$output/result.xcresult" \
  -only-testing:"LockScreenProbe/DownloadBesideReadingProbe/$method" test-without-building > "$output/test.log" 2>&1 || status=$?
if [[ -d "$output/result.xcresult" ]]; then
  xcrun xcresulttool export attachments --path "$output/result.xcresult" --output-path "$output/attachments" > /dev/null || true
fi
grep -E "Executed|error:" "$output/test.log" | tail -3 || true
printf 'Artifacts: %s\n' "$output"
exit "$status"
