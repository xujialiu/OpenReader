#!/bin/bash
# HOST red/green for FishKeyEntryProbe's field-read handling.
#
# - GREEN: extracts the exact pure classifier block from the live probe source
#   between its "HOST-TESTABLE CLASSIFIER" markers and compiles it unchanged on
#   the host with /usr/bin/swiftc (no XCTest, no simulator API), then runs a
#   13-case table (nil / non-String types / empty / legacy placeholder /
#   content) against independently written expected classifications. Must exit 0.
# - RED (honest failing-acceptance case): extracts the VERBATIM pre-repair
#   `isEmpty` method from blob FISH_CLASSIFIER_OLD_REF (default 2e56559), the
#   same Swift text compiled on the host with minimal stand-ins (an
#   `XCUIElement` value holder and a throwing `require`), adapts its
#   result/throw to the SAME 13-case classifications, and must exit 1 with the
#   exact mismatch `CASE emptyString expected=empty actual=unavailable`.
#   No handwritten reimplementation of the old logic and no substring-only
#   provenance: the compiled function is the extracted text itself.
# - No mutation: every generated file lives in one mktemp directory; the
#   production probe is never modified or moved by this script.
#
# Usage: bash test/manual-test/duo-verification/fish-classifier-red-green.sh
# Exit: 0 green table clean AND old process exited 1 on the exact emptyString
#   mismatch; 2 extraction/provenance failure; 1 any unexpected table result.
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

echo "== extraction: verbatim pre-repair isEmpty from blob $old_ref =="
git -C "$root" show "$old_ref:test/manual-test/kit/FishKeyEntryProbe.swift" > "$work/old-probe.swift"
for fragment in 'guard let value = field.value as? String, !value.isEmpty else' \
                'return value == "Not set"' \
                'require(false, "Secure API key state is unavailable")'; do
  grep -F -q "$fragment" "$work/old-probe.swift" \
    || { echo "FAIL: blob $old_ref lacks fragment: $fragment" >&2; exit 2; }
done
awk 'index($0, "private func isEmpty(_ field: XCUIElement) throws -> Bool {") {grab=1}
     grab {print}
     grab && $0 == "  }" {exit}' "$work/old-probe.swift" > "$work/old-isEmpty.swift"
[ -s "$work/old-isEmpty.swift" ] || { echo "FAIL: verbatim isEmpty not extracted" >&2; exit 2; }
grep -F -q 'guard let value = field.value as? String, !value.isEmpty else' "$work/old-isEmpty.swift" \
  || { echo "FAIL: extracted isEmpty is not the verbatim guard" >&2; exit 2; }
grep -cF 'field.value' "$work/old-isEmpty.swift" | grep -q '^1$' \
  || { echo "FAIL: extracted isEmpty must contain exactly one field.value read" >&2; exit 2; }
wc -l "$work/old-isEmpty.swift"

echo "== compile + run: repaired classifier (green, must exit 0) =="
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
set +e
"$work/new" > "$work/new.out" 2>&1
new_rc=$?
set -e
cat "$work/new.out"
echo "GREEN-EXIT=$new_rc"
[ "$new_rc" -eq 0 ] || { echo "FAIL: repaired classifier table must be green" >&2; exit 1; }

echo "== compile + run: VERBATIM pre-repair isEmpty (same acceptance table; must exit 1 on emptyString) =="
{
  cat <<'SWIFT'
import Foundation

// Minimal host stand-ins so the verbatim pre-repair method compiles unchanged:
// an XCUIElement that only carries the accessibility value, and the throwing
// require the extracted method calls. Nothing else is reimplemented.
struct XCUIElement { let value: Any? }
func require(_ condition: Bool, _ message: String) throws {
  if !condition { throw NSError(domain: "FishKeyEntryProbe", code: 1, userInfo: nil) }
}

SWIFT
  cat "$work/old-isEmpty.swift"
  cat <<'SWIFT'

// Adapts the verbatim method's result/throw to the SAME independently expected
// classifications the repaired classifier is judged against: throw -> its
// fail-closed unavailable; true -> empty; false -> nonempty.
func oldIsRead(_ raw: Any?) -> String {
  do {
    return try isEmpty(XCUIElement(value: raw)) ? "empty" : "nonempty"
  } catch {
    return "unavailable"
  }
}

let table: [(String, Any?, String)] = [
  ("nil", nil, "unavailable"),
  ("int7", 7, "unavailable"),
  ("double2_5", 2.5, "unavailable"),
  ("boolFalse", false, "unavailable"),
  ("arrayOfStrings", ["a", "b"], "unavailable"),
  ("nsObject", NSObject(), "unavailable"),
  ("emptyString", "", "empty"),
  ("legacyPlaceholder", "Not set", "empty"),
  ("singleSpace", " ", "nonempty"),
  ("maskedBullets", "••••••", "nonempty"),
  ("publicSentinel", "OPENREADER_PUBLIC_FISH_SENTINEL_8437", "nonempty"),
  ("arbitrarySecret", "sk-example-000", "nonempty"),
  ("switchValueZero", "0", "nonempty"),
]
var failures = 0
for (name, raw, expected) in table {
  let actual = oldIsRead(raw)
  if actual != expected { failures += 1 }
  print("CASE \(name) expected=\(expected) actual=\(actual) \(actual == expected ? "OK" : "MISMATCH")")
}
print("RED-TABLE failures=\(failures)")
exit(failures == 0 ? 0 : 1)
SWIFT
} > "$work/old-main.swift"
"$swiftc" -o "$work/old" "$work/old-main.swift"
set +e
"$work/old" > "$work/old.out" 2>&1
old_rc=$?
set -e
cat "$work/old.out"
echo "RED-EXIT=$old_rc"

echo "== honest red acceptance =="
[ "$old_rc" -eq 1 ] || { echo "FAIL: the verbatim pre-repair isEmpty must FAIL the shared acceptance table (exit 1), got $old_rc" >&2; exit 1; }
grep -q 'CASE emptyString expected=empty actual=unavailable MISMATCH' "$work/old.out" \
  || { echo "FAIL: exact emptyString failing-acceptance case missing" >&2; exit 1; }
[ "$(grep -c 'MISMATCH' "$work/old.out")" -eq 1 ] \
  || { echo "FAIL: the verbatim method must mismatch exactly the emptyString case" >&2; exit 1; }
grep -q 'CASE legacyPlaceholder expected=empty actual=empty OK' "$work/old.out" \
  && grep -q 'CASE nil expected=unavailable actual=unavailable OK' "$work/old.out" \
  && grep -q 'CASE int7 expected=unavailable actual=unavailable OK' "$work/old.out" \
  && grep -q 'CASE maskedBullets expected=nonempty actual=nonempty OK' "$work/old.out" \
  || { echo "FAIL: old acceptance table lines missing" >&2; exit 1; }

echo "RED/GREEN OK: the verbatim pre-repair isEmpty (blob $old_ref) fails the shared acceptance table exactly at emptyString (expected=empty, actual=unavailable, exit 1); the repaired classifier passes the same table (exit 0). The earlier old-guard characterization table remains recorded in notes as characterization."
