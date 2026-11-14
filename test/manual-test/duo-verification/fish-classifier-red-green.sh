#!/bin/bash
# HOST red/green for FishKeyEntryProbe's pure field-read classifier.
#
# - GREEN: extracts the exact pure classifier block from the live probe source
#   between its "HOST-TESTABLE CLASSIFIER" markers and compiles it unchanged on
#   the host with /usr/bin/swiftc (no XCTest, no simulator API), then runs a
#   table of nil / non-String / empty / legacy-placeholder / content cases
#   against independently written expected classifications.
# - RED: compiles an isolated copy of the pre-repair guard's decision whose
#   three decisive expressions are asserted verbatim inside the recorded
#   pre-repair blob (FISH_CLASSIFIER_OLD_REF, default 2e56559), and proves the
#   empty-String read classifies as unavailable there while the repaired
#   classifier classifies the same read empty.
# - No mutation: every generated file lives in one mktemp directory; the
#   production probe is never modified or moved by this script.
#
# Usage: bash test/manual-test/duo-verification/fish-classifier-red-green.sh
# Exit: 0 both harnesses match their characterization and the red case
#   diverges; 2 extraction/provenance failure; 1 any table disagreement.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
probe="$root/test/manual-test/kit/FishKeyEntryProbe.swift"
old_ref=${FISH_CLASSIFIER_OLD_REF:-2e56559}
swiftc=/usr/bin/swiftc

echo "== host compiler =="
"$swiftc" --version
echo "probe: $probe"
echo "pre-repair blob: $old_ref"

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

echo "== extraction: exact pure classifier block from the live probe =="
awk 'index($0, "HOST-TESTABLE CLASSIFIER") && index($0, "exact block begin") {on=1; next}
     index($0, "HOST-TESTABLE CLASSIFIER") && index($0, "exact block end") {on=0}
     on' "$probe" > "$work/classifier.swift"
[ -s "$work/classifier.swift" ] || { echo "FAIL: classifier block missing from $probe" >&2; exit 2; }
grep -vE '^\s*//' "$work/classifier.swift" > "$work/classifier-code.swift"
if grep -qE 'XCTest|XCUIApplication|XCUIElement|^import ' "$work/classifier-code.swift"; then
  echo "FAIL: classifier block must stay free of framework symbols and imports" >&2
  exit 2
fi
wc -l "$work/classifier-code.swift"

echo "== provenance: pre-repair guard fragments in blob $old_ref =="
git -C "$root" show "$old_ref:test/manual-test/kit/FishKeyEntryProbe.swift" > "$work/old-probe.swift"
grep -F -q 'guard let value = field.value as? String, !value.isEmpty else' "$work/old-probe.swift" \
  || { echo "FAIL: blob $old_ref lacks the old guard's read" >&2; exit 2; }
grep -F -q 'return value == "Not set"' "$work/old-probe.swift" \
  || { echo "FAIL: blob $old_ref lacks the old placeholder comparison" >&2; exit 2; }
grep -F -q 'require(false, "Secure API key state is unavailable")' "$work/old-probe.swift" \
  || { echo "FAIL: blob $old_ref lacks the old fail-closed branch" >&2; exit 2; }
echo "provenance OK: old guard expressions found verbatim in $old_ref"

echo "== compile + run: repaired classifier (green) =="
{
  echo 'import Foundation'
  cat "$work/classifier.swift"
  cat <<'SWIFT'

// Independently written expectations; the classifier is not consulted for them.
let table: [(String, Any?, FishKeyEntryFieldRead)] = [
  ("nil", nil, .unavailable),
  ("int7", 7, .unavailable),
  ("double2_5", 2.5, .unavailable),
  ("boolFalse", false, .unavailable),
  ("arrayOfStrings", ["a", "b"], .unavailable),
  ("nsObject", NSObject(), .unavailable),
  ("emptyString", "", .empty),
  ("legacyPlaceholder", "Not set", .empty),
  ("singleSpace", " ", .nonempty),
  ("maskedBullets", "••••••", .nonempty),
  ("publicSentinel", "OPENREADER_PUBLIC_FISH_SENTINEL_8437", .nonempty),
  ("arbitrarySecret", "sk-example-000", .nonempty),
  ("switchValueZero", "0", .nonempty),
]
var failures = 0
for (name, raw, expected) in table {
  let actual = classifyFishKeyEntryFieldValue(raw)
  if actual != expected { failures += 1 }
  print("CASE \(name) expected=\(expected) actual=\(actual) \(actual == expected ? "OK" : "MISMATCH")")
}
print("GREEN-TABLE failures=\(failures)")
exit(failures == 0 ? 0 : 1)
SWIFT
} > "$work/new-main.swift"
"$swiftc" -o "$work/new" "$work/new-main.swift"
"$work/new" | tee "$work/new.out"

echo "== compile + run: isolated copy of the pre-repair guard (red) =="
cat > "$work/old-main.swift" <<'SWIFT'
import Foundation

// Isolated decision copy of the pre-repair isEmpty guard. Its three decisive
// expressions were asserted verbatim inside blob 2e56559 above; the field read
// is renamed raw and the XCTFail/throw branch becomes nil (unavailable).
func oldGuardEmptyRead(_ raw: Any?) -> Bool? {
  guard let value = raw as? String, !value.isEmpty else { return nil }
  return value == "Not set"
}

let table: [(String, Any?, Bool?)] = [
  ("nil", nil, nil),
  ("int7", 7, nil),
  ("double2_5", 2.5, nil),
  ("boolFalse", false, nil),
  ("arrayOfStrings", ["a", "b"], nil),
  ("nsObject", NSObject(), nil),
  ("emptyString", "", nil),
  ("legacyPlaceholder", "Not set", true),
  ("singleSpace", " ", false),
  ("maskedBullets", "••••••", false),
  ("publicSentinel", "OPENREADER_PUBLIC_FISH_SENTINEL_8437", false),
  ("arbitrarySecret", "sk-example-000", false),
  ("switchValueZero", "0", false),
]
let label: (Bool?) -> String = { read in read == nil ? "unavailable" : (read == true ? "empty" : "nonempty") }
var failures = 0
for (name, raw, expected) in table {
  let actual = oldGuardEmptyRead(raw)
  if actual != expected { failures += 1 }
  print("CASE \(name) expected=\(label(expected)) actual=\(label(actual)) \(actual == expected ? "OK" : "MISMATCH")")
}
print("RED-TABLE failures=\(failures)")
exit(failures == 0 ? 0 : 1)
SWIFT
"$swiftc" -o "$work/old" "$work/old-main.swift"
"$work/old" | tee "$work/old.out"

echo "== red capability: the repaired case must diverge =="
grep -q 'CASE emptyString expected=empty actual=empty OK' "$work/new.out" \
  || { echo "FAIL: repaired classifier does not classify an empty String read as empty" >&2; exit 1; }
grep -q 'CASE emptyString expected=unavailable actual=unavailable OK' "$work/old.out" \
  || { echo "FAIL: pre-repair guard does not characterize as unavailable on the empty String read" >&2; exit 1; }
grep -q 'CASE nil expected=unavailable actual=unavailable OK' "$work/new.out" \
  && grep -q 'CASE int7 expected=unavailable actual=unavailable OK' "$work/new.out" \
  || { echo "FAIL: repaired classifier must keep nil/non-String unavailable (fail closed)" >&2; exit 1; }

echo "RED/GREEN OK: pre-repair guard (blob $old_ref) classifies an empty String read as unavailable while the repaired classifier classifies it empty, with nil/non-String still unavailable and the full table green."
