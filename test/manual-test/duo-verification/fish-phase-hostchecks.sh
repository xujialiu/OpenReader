#!/bin/bash
# HOST-ONLY fatal-path and scanner controls for the Fish public-sentinel phase.
# No device, simulator, network, Metro or repository mutation: everything runs
# in mktemp trees, with fake lsof/ps/plutil tools on PATH and a fake artifact
# tree for the scanner. Checks:
#   - phase lib fatal paths: attempt-dir ownership/mode, exact single fresh
#     result binding (zero/multiple/stale/mismatch), per-value plist identity
#     (version/build/Metro port/UDID-bound canonical path), Metro PID+cwd
#     receipt, export failure/empty handling, HOLD record.
#   - scanner controls: positive clean tree with hash-pinned static origins;
#     negative plain / Type-activity / UTF-16LE binary / hex / base64 /
#     per-char-split injections; HOLD on missing activity export and on a
#     staged input still present.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
lib="$root/test/manual-test/duo-verification/fish-phase-lib.sh"
scanner="$root/test/manual-test/duo-verification/fish-privacy-scan.py"
runner="$root/test/manual-test/duo-verification/fish-classifier-red-green.sh"
failures=0
note() { printf '%s\n' "$*"; }
check() { # NAME EXPECTED(ok|fail) CMD...
  local name=$1 expect=$2
  shift 2
  if "$@" >/dev/null 2>&1; then
    [ "$expect" = ok ] && note "HOSTCHECK-OK   $name" || { note "HOSTCHECK-FAIL $name: expected failure, succeeded"; failures=$((failures+1)); }
  else
    [ "$expect" = fail ] && note "HOSTCHECK-OK   $name (fatal path failed as required)" || { note "HOSTCHECK-FAIL $name: expected success, failed"; failures=$((failures+1)); }
  fi
}

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir -m 700 "$work/fakebin"
cat > "$work/fakebin/lsof" <<'EOF'
#!/bin/bash
if [[ "$*" == *"-sTCP:LISTEN"* ]]; then
  [ -n "${FAKE_LISTEN_PID:-}" ] && printf '%s\n' "$FAKE_LISTEN_PID"
  exit 0
fi
if [[ "$*" == *"-d cwd"* ]]; then
  printf 'COMMAND  PID USER   FD   TYPE NODE NAME\n'
  printf 'node   %s user  cwd  DIR  %s\n' "${FAKE_CWD_PID:-1}" "${FAKE_CWD:-/nowhere}"
  exit 0
fi
exit 1
EOF
cat > "$work/fakebin/ps" <<'EOF'
#!/bin/bash
printf '%s\n' "${FAKE_PS_LINE:-}"
EOF
cat > "$work/fakebin/plutil" <<'EOF'
#!/bin/bash
key=""; prev=""
for a in "$@"; do
  [ "$prev" = "-extract" ] && key=$a
  prev=$a
done
[ -n "$key" ] || exit 1
line=$(grep -m1 "^$key=" "${FAKE_PLIST:?}") || exit 1
printf '%s\n' "${line#*=}"
EOF
chmod 700 "$work/fakebin"/*
export PATH="$work/fakebin:$PATH"

. "$lib"

echo "== phase lib: attempt-dir ownership/mode =="
A1="$work/attempt-ok"; mkdir -m 700 "$A1"
check "attempt-dir ok" ok phase_require_attempt_dir "$A1"
chmod 755 "$A1"
check "attempt-dir mode 755 rejected" fail phase_require_attempt_dir "$A1"
check "attempt-dir missing rejected" fail phase_require_attempt_dir "$work/attempt-missing"

echo "== phase lib: exact single fresh result binding =="
P="$work/probe"; mkdir -p "$P"
INV="$P/invocation.log"
STAMP="$work/phase-start.stamp"; touch "$STAMP"
RES="$P/result-111111-0000-1.xcresult"; mkdir "$RES"
touch "$RES/Info.plist"
printf 'Artifacts: %s (result: %s, log: %s)\n' "$P" "$RES" "$P/test-111111-0000-1.log" > "$INV"
bind_ok() { local got; got=$(phase_bind_result "$P" "$INV" "$STAMP"); [ "$got" = "$RES" ]; }
check "bind ok (one fresh matching result)" ok bind_ok
mkdir "$P/result-111111-0000-2.xcresult"
check "bind two results rejected" fail phase_bind_result "$P" "$INV" "$STAMP"
rm -r "$P/result-111111-0000-2.xcresult"
touch -t 202001010000 "$RES/Info.plist"
check "bind stale result rejected" fail phase_bind_result "$P" "$INV" "$STAMP"
touch "$RES/Info.plist"
printf 'Artifacts: %s (result: %s/other.xcresult, log: %s)\n' "$P" "$P" "$P/test.log" > "$INV"
check "bind mismatched Artifacts path rejected" fail phase_bind_result "$P" "$INV" "$STAMP"
mv "$RES" "$RES-keep" && mv "$RES-keep" "$RES"
printf 'no artifacts line here\n' > "$INV"
check "bind missing Artifacts line rejected" fail phase_bind_result "$P" "$INV" "$STAMP"
printf 'Artifacts: %s (result: %s, log: %s)\n' "$P" "$RES" "$P/test-111111-0000-1.log" > "$INV"

echo "== phase lib: plist identity asserted per value and UDID-bound =="
PL="$work/plist.txt"; touch "$PL"
printf 'CFBundleShortVersionString=1.0.4\nCFBundleVersion=30\nRCTMetroPort=8437\n' > "$PL"
export FAKE_PLIST="$PL"
BUNDLE="$work/Devices/40DC7F6C-3500-480D-A0FB-147AEF50C609/data/Containers/Bundle/Application/ABC/OpenReader.app"
mkdir -p "$BUNDLE"; : > "$BUNDLE/Info.plist"
check "plist identity ok" ok phase_assert_plist_identity "$BUNDLE" "40DC7F6C-3500-480D-A0FB-147AEF50C609"
printf 'CFBundleShortVersionString=1.0.5\nCFBundleVersion=30\nRCTMetroPort=8437\n' > "$PL"
check "plist wrong version rejected" fail phase_assert_plist_identity "$BUNDLE" "40DC7F6C-3500-480D-A0FB-147AEF50C609"
printf 'CFBundleShortVersionString=1.0.4\nCFBundleVersion=28\nRCTMetroPort=8437\n' > "$PL"
check "plist wrong build rejected" fail phase_assert_plist_identity "$BUNDLE" "40DC7F6C-3500-480D-A0FB-147AEF50C609"
printf 'CFBundleShortVersionString=1.0.4\nCFBundleVersion=30\nRCTMetroPort=8081\n' > "$PL"
check "plist wrong metro port rejected" fail phase_assert_plist_identity "$BUNDLE" "40DC7F6C-3500-480D-A0FB-147AEF50C609"
check "plist path without UDID rejected" fail phase_assert_plist_identity "$work/Devices/other/Bundle/OpenReader.app" "40DC7F6C-3500-480D-A0FB-147AEF50C609"
check "plist bundle not OpenReader.app rejected" fail phase_assert_plist_identity "$work/Devices/40DC7F6C-3500-480D-A0FB-147AEF50C609/data/Other.app" "40DC7F6C-3500-480D-A0FB-147AEF50C609"

echo "== phase lib: Metro PID/start/cwd/listener receipt =="
REPO="/Users/xujialiu/Works/openreader/.worktrees/ios353"
export FAKE_PS_LINE='Sat Nov 14 23:49:55 2026 node /repo/node_modules/.bin/expo start --port 8437'
FAKE_LISTEN_PID=88854 FAKE_CWD="$REPO" FAKE_CWD_PID=88854 \
  check "metro receipt ok" ok phase_assert_metro 88854 8437 "$REPO"
FAKE_PS_LINE='node something-else --port 8437' FAKE_LISTEN_PID=88854 FAKE_CWD="$REPO" \
  check "metro wrong command rejected" fail phase_assert_metro 88854 8437 "$REPO"
FAKE_PS_LINE='Sat Nov 14 23:49:55 2026 node /repo/node_modules/.bin/expo start --port 8437' \
  FAKE_LISTEN_PID=99999 FAKE_CWD="$REPO" \
  check "metro listener pid mismatch rejected" fail phase_assert_metro 88854 8437 "$REPO"
FAKE_PS_LINE='Sat Nov 14 23:49:55 2026 node /repo/node_modules/.bin/expo start --port 8437' \
  FAKE_LISTEN_PID=88854 FAKE_CWD="/elsewhere" \
  check "metro cwd mismatch rejected" fail phase_assert_metro 88854 8437 "$REPO"
FAKE_PS_LINE='' FAKE_LISTEN_PID=88854 FAKE_CWD="$REPO" \
  check "metro dead pid rejected" fail phase_assert_metro 88854 8437 "$REPO"

echo "== phase lib: export failure/empty handling and HOLD record =="
check "export ok" ok phase_run_export "$work/out.txt" "$work/err.txt" sh -c 'echo data'
[ -s "$work/out.txt" ] || { note "HOSTCHECK-FAIL export output missing"; failures=$((failures+1)); }
check "export failing command rejected" fail phase_run_export "$work/out2.txt" "$work/err2.txt" false
grep -q 'EXPORT-FAILED' "$work/err2.txt" || { note "HOSTCHECK-FAIL export error not recorded"; failures=$((failures+1)); }
check "export empty output rejected" fail phase_run_export "$work/out3.txt" "$work/err3.txt" true
phase_write_hold "$A1" "synthetic reason" >/dev/null 2>&1
grep -q 'HOLD: synthetic reason' "$A1/hold-record.txt" \
  || { note "HOSTCHECK-FAIL hold record missing"; failures=$((failures+1)); }
note "HOSTCHECK-OK   hold record written"

echo "== scanner: positive clean tree with hash-pinned static origins =="
mk_tree() { # FAKEROOT
  local f=$1
  rm -rf "$f"; mkdir -p "$f/A/public-probe" "$f/repo" "$f/prep"
  mkdir -p "$f/A/public-probe/result-T.xcresult"
  mkdir -p "$f/A/public-probe/attachments-export"
  mkdir -p "$f/A/public-probe/diagnostics"
  mkdir -p "$f/A/public-probe/build/Build/Products/Debug-iphonesimulator/LockScreenProbe-Runner.app/PlugIns/LockScreenProbe.xctest"
  mkdir -p "$f/A/public-probe/build/Build/Intermediates.noindex/ManualTests.build/Debug-iphonesimulator/LockScreenProbe.build/Objects-normal/arm64"
  printf 'Artifacts: %s (result: %s, log: %s)\n' \
    "$f/A/public-probe" "$f/A/public-probe/result-T.xcresult" "$f/A/public-probe/test-T.log" \
    > "$f/A/probe-invocation.log"
  printf 'build log, no sentinel\n' > "$f/A/public-probe/build-0001.log"
  { printf 'test log, no sentinel\n'; printf 't = 0.10s Type %s into "untitled" field\n' "'hello world'"; } > "$f/A/public-probe/test-T.log"
  printf '{"tests":[]}\n' > "$f/A/public-probe/tests-export.json"
  printf '{"result":"Passed","failedTests":0}\n' > "$f/A/summary-export.json"
  printf '{"activities":[]}\n' > "$f/A/public-probe/activities-export.json"
  printf '[]\n' > "$f/A/public-probe/attachments-export/manifest.json"
  printf 'bplist00-fake\n' > "$f/A/public-probe/result-T.xcresult/Info.plist"
  { printf '// fake probe source\nlet publicSentinel = "'; printf '%s' "OPENREADER_PUBLIC_FISH_SENTINEL_8437"; printf '"\n'; } > "$f/repo/FishKeyEntryProbe.swift"
  { printf '# fake prep phase script\nSENTINEL="'; printf '%s' "OPENREADER_PUBLIC_FISH_SENTINEL_8437"; printf '"\n'; } > "$f/prep/public-phase.sh"
  { printf 'fake compiled constant '; printf '%s' "OPENREADER_PUBLIC_FISH_SENTINEL_8437"; printf '\n'; } \
    > "$f/A/public-probe/build/Build/Products/Debug-iphonesimulator/LockScreenProbe-Runner.app/PlugIns/LockScreenProbe.xctest/LockScreenProbe"
  { printf 'fake object '; printf '%s' "OPENREADER_PUBLIC_FISH_SENTINEL_8437"; printf '\n'; } \
    > "$f/A/public-probe/build/Build/Intermediates.noindex/ManualTests.build/Debug-iphonesimulator/LockScreenProbe.build/Objects-normal/arm64/FishKeyEntryProbe.o"
}
scan() { # FAKE_ROOT -> exit code of scanner
  python3 "$scanner" --attempt "$1/A" --prep "$1/prep" \
    --repo-source "$1/repo/FishKeyEntryProbe.swift" --runner-source "$runner"
}
T="$work/tree-clean"; mk_tree "$T"
SOUT=$(scan "$T" 2>&1) && scan_rc=0 || scan_rc=$?
[ "$scan_rc" -eq 0 ] && grep -q '"verdict": "PRIVACY-CLEAN"' "$T/A/privacy-scan-report.json" \
  && note "HOSTCHECK-OK   scanner clean tree exit 0 PRIVACY-CLEAN" \
  || { note "HOSTCHECK-FAIL scanner clean tree (rc=$scan_rc)"; failures=$((failures+1)); }

echo "== scanner: negative injections =="
inject_case() { # NAME EXPECTED_RC SETUP_FN
  local name=$1 expect_rc=$2 setup=$3
  local t="$work/tree-$name"
  mk_tree "$t"
  "$setup" "$t"
  local rc=0; scan "$t" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq "$expect_rc" ]; then
    note "HOSTCHECK-OK   scanner $name exit $rc"
  else
    note "HOSTCHECK-FAIL scanner $name: expected exit $expect_rc got $rc"; failures=$((failures+1))
  fi
}
inject_plain() { printf 'leak OPENREADER_PUBLIC_FISH_SENTINEL_8437 plain\n' >> "$1/A/public-probe/test-T.log"; }
inject_type() { printf 't = 1.00s Type "OPENREADER_PUBLIC_FISH_SENTINEL_8437" into "API key" text field\n' >> "$1/A/public-probe/test-T.log"; }
inject_utf16_result() { python3 - "$1" <<'PY'
import sys
p = sys.argv[1] + "/A/public-probe/result-T.xcresult/Info.plist"
open(p, "ab").write("OPENREADER_PUBLIC_FISH_SENTINEL_8437".encode("utf-16-le"))
PY
}
inject_utf16_text() { python3 - "$1" <<'PY'
import sys
p = sys.argv[1] + "/A/public-probe/tests-export.json"
open(p, "ab").write(b"\xff\xfe garbage-not-utf8-no-sentinel")
PY
}
inject_hex() { python3 - "$1" <<'PY'
import sys
p = sys.argv[1] + "/A/public-probe/build-0001.log"
open(p, "a").write("hex leak " + "OPENREADER_PUBLIC_FISH_SENTINEL_8437".encode().hex() + "\n")
PY
}
inject_b64() { python3 - "$1" <<'PY'
import base64, sys
p = sys.argv[1] + "/A/summary-export.json"
open(p, "a").write(base64.b64encode(b"OPENREADER_PUBLIC_FISH_SENTINEL_8437").decode() + "\n")
PY
}
inject_split() { python3 - "$1" <<'PY'
import sys
p = sys.argv[1] + "/A/public-probe/test-T.log"
lines = ['t = 1.00s Type "O" into "API key" text field']
for c in "PENREADER_PUBLIC_FISH_SENTINEL_8437":
    lines.append('t = %d.00s Find the "Not set" SecureTextField' % 2)
    lines.append('t = %d.00s Type "%s" into "API key" text field' % (3, c))
open(p, "a").write("\n".join(lines) + "\n")
PY
}
inject_case plain-leak 1 inject_plain
inject_truncated_single() { printf 't =     3.67s Type %s into "Not set" SecureTextField\n' "'OPENREADER_PUBLIC_...'" >> "$1/A/public-probe/test-T.log"; }
inject_truncated_double() { printf 't =     3.67s Type %s into "Not set" SecureTextField\n' '"OPENREADER_PUBLIC_..."' >> "$1/A/public-probe/test-T.log"; }
inject_perchar() { python3 - "$1" <<'PY'
import sys
p = sys.argv[1] + "/A/public-probe/test-T.log"
lines = []
for i, c in enumerate("OPENREADER_PUBLIC_FISH_SENTINEL_8437"):
    lines.append('t =     %d.00s Type %s into "Not set" SecureTextField' % (i + 1, "'" + c + "'"))
open(p, "a").write("\n".join(lines) + "\n")
PY
}
inject_case type-activity-definite-fail 1 inject_type
check "type-activity flagged in report" ok python3 - "$work/tree-type-activity-definite-fail/A/privacy-scan-report.json" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
assert report["verdict"] == "PRIVACY-NOT-QUALIFIED", report["verdict"]
assert any(l.get("type_activity") for l in report["leaks"]), report["leaks"]
PY
inject_case truncated-single-quoted-leak 1 inject_truncated_single
inject_case truncated-double-quoted-leak 1 inject_truncated_double
inject_case perchar-reconstruction-leak 1 inject_perchar
check "truncated prefix flagged as shared-prefix leak" ok python3 - "$work/tree-truncated-single-quoted-leak/A/privacy-scan-report.json" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
assert report["verdict"] == "PRIVACY-NOT-QUALIFIED", report["verdict"]
assert any(l.get("shared_prefix_chars", 0) >= 4 for l in report["leaks"]), report["leaks"]
PY
inject_case utf16-binary-leak 1 inject_utf16_result
inject_case undecodable-text-no-leak-hold 2 inject_utf16_text
inject_case hex-leak 1 inject_hex
inject_case base64-leak 1 inject_b64
inject_case per-char-split-leak 1 inject_split
inject_no_activities() { rm "$1/A/public-probe/activities-export.json"; }
inject_case missing-activity-hold 2 inject_no_activities
inject_staged() { printf 'staged' > "$1/A/fish-api-key.txt"; }
inject_case staged-input-hold 2 inject_staged

echo "== hostchecks summary =="
if [ "$failures" -eq 0 ]; then
  note "HOSTCHECKS-ALL-OK"
else
  note "HOSTCHECKS-FAILED count=$failures"
fi
exit "$failures"
