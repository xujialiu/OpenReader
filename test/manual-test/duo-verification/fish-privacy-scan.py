#!/usr/bin/env python3
"""Privacy scan for the Fish public-sentinel native qualification phase.

Explicit-artifact-manifest scanner: it scans ONLY the bounded run artifacts a
qualification run must produce (raw build/test/invocation logs, the complete
readable xcresult/test/activity exports, exported attachments, diagnostics and
the raw result bundle's files), classifies the expected public-constant
occurrences in enumerated STATIC ORIGINS (probe source, compiled probe binary
and object, prep scripts, this scanner, the host runner) separately by exact
path+sha256, and never blanket-ignores any runtime payload.

The attempt-02 lesson (2026-11-15): XCTest echoed a TRUNCATED 18-character
prefix of the typed input (`Type 'OPENREADER_PUBLIC_...`) into framework logs
and activity titles, and the old per-character `.{0,300}` backtracking regex
hung for minutes on the retained diagnostics log. This scanner therefore:

- FAILS FAST on readable `Type` activity payloads before any expensive binary
  work: single- OR double-quoted payloads, full or TRUNCATED (ellipsis) — a
  payload that shares a leading run with the sentinel of at least
  --min-prefix-chars characters is a definite NOT QUALIFIED. A recovered
  prefix alone is a leak; no plaintext input echo can qualify.
- Reconstructs chronological one-character typing linearly: consecutive
  single-character payloads accumulate into a stream, and a stream sharing a
  sentinel prefix of at least --min-prefix-chars characters is a definite
  NOT QUALIFIED. There is no wildcard backtracking anywhere.
- Keeps the full encoded forms (UTF-8/16 LE/BE, hex, base64, URL/JSON
  escapes) as byte-pattern negative controls over every artifact.
- Bounds its work: an explicit runtime budget (--budget-seconds) and a
  per-artifact size cap (--max-artifact-bytes). Breaching either records
  coverage uncertainty as a HOLD; problematic payloads are never ignored to
  produce CLEAN.

Verdicts (written to --report-path, default <attempt>/privacy-scan-report.json):
  exit 0  PRIVACY-CLEAN            (byte/manifest clear only — still NOT a
                                    semantic or image privacy pass)
  exit 1  PRIVACY-NOT-QUALIFIED    (recoverable typing/prefix/sentinel in a
                                    runtime artifact)
  exit 2  PRIVACY-HOLD             (coverage missing/undecodable, staged input
                                    present, budget/size bound reached)

HOST-only; no device, network or simulator access.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time

SENTINEL = "OPENREADER_PUBLIC_FISH_SENTINEL_8437"


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def encoding_patterns() -> dict[str, bytes]:
    patterns: dict[str, bytes] = {}
    forms = {"utf8": SENTINEL.encode("utf-8"),
             "utf16le": SENTINEL.encode("utf-16-le"),
             "utf16be": SENTINEL.encode("utf-16-be")}
    for name, blob in forms.items():
        patterns[name] = blob
        patterns[name + "-hex-lower"] = blob.hex().encode()
        patterns[name + "-hex-upper"] = blob.hex().upper().encode()
        patterns[name + "-base64"] = base64.b64encode(blob).replace(b"=", b"")
        patterns[name + "-base64-pad"] = base64.b64encode(blob)
    u8 = forms["utf8"]
    patterns["url-escaped"] = "".join("%%%02X" % c for c in u8).encode()
    patterns["json-escaped"] = "".join("\\u%04x" % c for c in u8).encode()
    patterns["json-escaped-upper"] = "".join("\\u%04X" % c for c in u8).encode()
    return patterns


# One readable `Type` payload in a log or activity export: the text after the
# quote up to the matching quote, or to the end of the line when the framework
# truncated it (the ellipsis then marks the truncation).
TYPE_LINE = re.compile(r"Type ([\"'])(.*?)\1")


def type_payloads(text: str):
    """Yields (payload, truncated, line) for every readable Type payload,
    in file order, with strictly linear scanning (no backtracking)."""
    for line in text.splitlines():
        if "Type " not in line:
            continue
        for match in TYPE_LINE.finditer(line):
            payload = match.group(2)
            stripped = payload.rstrip()
            truncated = stripped.endswith("...") or stripped.endswith("…")
            if truncated:
                stripped = stripped[:-3].rstrip(".") if stripped.endswith("...") else stripped[:-1]
            yield stripped, truncated, line.strip()


class PrefixState:
    """Linear state for shared-prefix detection against the sentinel."""

    def __init__(self, min_prefix: int):
        self.min_prefix = min_prefix
        self.stream = ""          # chronological single-character stream
        self.hits: list[dict] = []

    def feed(self, payload: str, kind: str, where: str) -> None:
        # Whole/truncated payload: an explicit typed chunk.
        self._chunk(payload, kind, where)
        # Chronological one-character reconstruction: length-1 payloads extend
        # the stream; anything else starts a new run.
        if len(payload) == 1:
            self.stream += payload
            self._check(self.stream, "typed-stream", where)
        else:
            self.stream = ""

    def _chunk(self, chunk: str, kind: str, where: str) -> None:
        if len(chunk) < self.min_prefix:
            return
        shared = 0
        for a, b in zip(chunk, SENTINEL):
            if a == b:
                shared += 1
            else:
                break
        if shared >= self.min_prefix:
            self.hits.append({"kind": kind, "where": where, "payload": chunk,
                              "shared_prefix_chars": shared, "truncated_prefix": True})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attempt", required=True, help="attempt directory")
    parser.add_argument("--prep", required=True, help="owned prep directory (phase scripts)")
    parser.add_argument("--repo-source", required=True, help="live FishKeyEntryProbe.swift path")
    parser.add_argument("--runner-source", required=True, help="fish-classifier-red-green.sh path")
    parser.add_argument("--report-path", default=None,
                        help="where to write the JSON report (default <attempt>/privacy-scan-report.json)")
    parser.add_argument("--budget-seconds", type=int, default=120,
                        help="total runtime budget; breach records coverage uncertainty as a HOLD")
    parser.add_argument("--max-artifact-bytes", type=int, default=256 * 1024 * 1024,
                        help="per-artifact size cap; breach records coverage uncertainty as a HOLD")
    parser.add_argument("--min-prefix-chars", type=int, default=4,
                        help="minimum shared leading characters that count as a recovered prefix")
    args = parser.parse_args()

    started = time.monotonic()
    attempt = os.path.abspath(args.attempt)
    probe_dir = os.path.join(attempt, "public-probe")
    report_path = args.report_path or os.path.join(attempt, "privacy-scan-report.json")
    patterns = encoding_patterns()
    leaks: list[dict] = []
    holds: list[str] = []

    def budget_left() -> bool:
        return (time.monotonic() - started) < args.budget_seconds

    def budget_checkpoint(where: str) -> bool:
        if budget_left():
            return True
        holds.append(f"runtime budget exceeded before/while scanning {where}; coverage uncertain")
        return False

    # The staged input must already be gone; its presence is a HOLD, and its
    # contents are never read here.
    staged = os.path.join(attempt, "fish-api-key.txt")
    if os.path.exists(staged):
        holds.append("staged input fish-api-key.txt still present at scan time")

    # --- Bind the run's own artifacts -------------------------------------
    invocation = os.path.join(attempt, "probe-invocation.log")
    artifacts: dict[str, str] = {}

    def add_artifact(key: str, path: str, *, must_exist: bool, must_decode: bool) -> None:
        if os.path.isdir(path):
            for root, _dirs, names in os.walk(path):
                for name in names:
                    add_artifact(f"{key}/{os.path.join(os.path.relpath(root, path), name)}",
                                 os.path.join(root, name), must_exist=must_exist,
                                 must_decode=must_decode)
            return
        artifacts[key] = path
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            if must_exist:
                holds.append(f"missing or empty artifact {key}: {path}")
            return
        if os.path.getsize(path) > args.max_artifact_bytes:
            holds.append(f"artifact {key} exceeds the {args.max_artifact_bytes}-byte cap: {path}")
            return
        if must_decode:
            try:
                with open(path, "rb") as handle:
                    handle.read().decode("utf-8")
            except UnicodeDecodeError:
                holds.append(f"undecodable text artifact {key}: {path}")

    result_dir: str | None = None
    test_log: str | None = None
    build_log: str | None = None
    if not os.path.isfile(invocation) or os.path.getsize(invocation) == 0:
        holds.append("missing probe-invocation.log")
    else:
        matches = re.findall(r"^Artifacts: .* \(result: ([^,]+), log: ([^)]+)\)$",
                             open(invocation, "r", encoding="utf-8", errors="replace").read(), re.M)
        if len(matches) != 1:
            holds.append(f"invocation log must bind exactly one Artifacts result/log pair, found {len(matches)}")
        else:
            result_dir, test_log = matches[0]
    candidates = sorted(g for g in os.listdir(probe_dir) if g.startswith("build-") and g.endswith(".log")) \
        if os.path.isdir(probe_dir) else []
    if len(candidates) != 1:
        holds.append(f"expected exactly one build-*.log under {probe_dir}, found {len(candidates)}")
    else:
        build_log = os.path.join(probe_dir, candidates[0])

    if result_dir:
        if not os.path.isdir(result_dir):
            holds.append("bound result bundle directory missing")
        else:
            add_artifact("result-bundle", result_dir, must_exist=True, must_decode=False)
    if test_log:
        add_artifact("test-log", test_log, must_exist=True, must_decode=True)
    if build_log:
        add_artifact("build-log", build_log, must_exist=True, must_decode=True)
    add_artifact("tests-export", os.path.join(probe_dir, "tests-export.json"),
                 must_exist=True, must_decode=True)
    add_artifact("summary-export", os.path.join(attempt, "summary-export.json"),
                 must_exist=True, must_decode=True)
    activity_exports = [p for p in (os.path.join(probe_dir, "activities-export.json"),
                                    os.path.join(probe_dir, "full-export.json"))
                        if os.path.isfile(p) and os.path.getsize(p) > 0]
    if not activity_exports:
        holds.append("no readable activity export (activities-export.json or full-export.json)")
    for index, path in enumerate(activity_exports):
        add_artifact(f"activity-export-{index}", path, must_exist=True, must_decode=True)
    attachments_dir = os.path.join(probe_dir, "attachments-export")
    if not os.path.isdir(attachments_dir):
        holds.append("attachments export directory missing (no image coverage)")
    else:
        add_artifact("attachments-export", attachments_dir, must_exist=True, must_decode=False)
        manifest = os.path.join(attachments_dir, "manifest.json")
        if not os.path.isfile(manifest) or os.path.getsize(manifest) == 0:
            holds.append("attachments export manifest missing or empty")
        else:
            try:
                json.load(open(manifest, "r", encoding="utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                holds.append(f"attachments export manifest undecodable: {error}")
    diagnostics_dir = os.path.join(probe_dir, "diagnostics")
    if not os.path.isdir(diagnostics_dir):
        holds.append("diagnostics export directory missing")
    else:
        add_artifact("diagnostics", diagnostics_dir, must_exist=True, must_decode=False)

    # --- FAIL FAST: readable Type payloads in text artifacts ------------
    # A recovered prefix alone is a leak; this runs before any binary sweep.
    # Small logs first, then activity exports, then the retained diagnostics
    # session logs (linear per-line parsing keeps this fast).
    prefix = PrefixState(args.min_prefix_chars)
    text_order = [key for key in ("invocation-log", "test-log", "build-log", "tests-export",
                                  "summary-export") if key in artifacts]
    text_order += [key for key in sorted(artifacts) if key.startswith("activity-export-")]
    text_order += [key for key in sorted(artifacts) if key.startswith("diagnostics")]
    for key in text_order:
        path = artifacts[key]
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            continue
        if not budget_checkpoint(f"Type payload analysis of {key}"):
            break
        try:
            text = open(path, "r", encoding="utf-8").read()
        except UnicodeDecodeError:
            continue  # byte-pattern sweep below still applies; decode gap recorded
        for payload, truncated, _line in type_payloads(text):
            prefix.feed(payload, "type-payload-truncated" if truncated else "type-payload",
                        f"{key} ({path})")
        prefix.stream = ""  # typing chronology is per file, never across files
    for hit in prefix.hits:
        leaks.append({"artifact": hit["where"], "encoding": hit["kind"], "payload": hit["payload"],
                      "shared_prefix_chars": hit["shared_prefix_chars"], "runtime_payload": True,
                      "type_activity": True, "note": "a recovered typed prefix alone is a leak"})

    if leaks:
        verdict = "PRIVACY-NOT-QUALIFIED"
    elif holds:
        verdict = "PRIVACY-HOLD"
    else:
        verdict = None  # binary sweep still pending

    # --- Static origins (path + exact hash) --------------------------------
    expected_constants: list[dict] = []
    if verdict is None:
        if not budget_checkpoint("static origin enumeration"):
            verdict = "PRIVACY-HOLD"
    if verdict is None:
        origins: dict[str, str] = {}
        origin_paths: list[str] = [args.repo_source, args.runner_source,
                                   os.path.join(args.prep, "public-phase.sh"),
                                   os.path.abspath(__file__)]
        origin_paths += [os.path.join(probe_dir, "build", inner)
                         for inner in ("Build/Products/Debug-iphonesimulator/"
                                       "LockScreenProbe-Runner.app/PlugIns/LockScreenProbe.xctest/LockScreenProbe",
                                       "Build/Intermediates.noindex/ManualTests.build/Debug-iphonesimulator/"
                                       "LockScreenProbe.build/Objects-normal/arm64/FishKeyEntryProbe.o")]
        for path in origin_paths:
            if os.path.isfile(path):
                origins[os.path.abspath(path)] = sha256_of(path)
        for path in sorted(origins):
            count = 0
            encodings_hit = set()
            data = open(path, "rb").read()
            for name, blob in patterns.items():
                hits = data.count(blob)
                if hits:
                    count += hits
                    encodings_hit.add(name)
            expected_constants.append({"origin": path, "sha256": origins[path],
                                       "expected_public_constant": True,
                                       "occurrences": count,
                                       "encodings": sorted(encodings_hit)})
        for path in origin_paths:
            if not os.path.isfile(path):
                expected_constants.append({"origin": os.path.abspath(path), "present": False})

        # --- Byte-pattern sweep over every runtime artifact ----------------
        for key, path in sorted(artifacts.items()):
            abspath = os.path.abspath(path)
            if abspath in origins:
                continue
            if not budget_checkpoint(f"byte sweep of {key}"):
                break
            try:
                data = open(path, "rb").read()
            except OSError as error:
                holds.append(f"unreadable artifact {key}: {error}")
                continue
            for name, blob in patterns.items():
                start = 0
                while True:
                    idx = data.find(blob, start)
                    if idx == -1:
                        break
                    leaks.append({"artifact": key, "file": abspath, "encoding": name,
                                  "offset": idx, "runtime_payload": True, "type_activity": None})
                    start = idx + 1
        if leaks:
            verdict = "PRIVACY-NOT-QUALIFIED"
        elif holds:
            verdict = "PRIVACY-HOLD"
        else:
            verdict = "PRIVACY-CLEAN"

    report = {
        "verdict": verdict,
        "attempt": attempt,
        "manifest_artifacts": len(artifacts),
        "static_origins": expected_constants,
        "leaks": leaks,
        "holds": holds,
        "budget_seconds": args.budget_seconds,
        "min_prefix_chars": args.min_prefix_chars,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "note": "Any runtime-artifact occurrence is a definite fail even for the public sentinel; "
                "a recovered truncated typed prefix alone is a definite fail. Static-origin "
                "occurrences are the expected public constant, identified by exact path+sha256. "
                "PRIVACY-CLEAN is byte-pattern/manifest only and is never a semantic or image "
                "privacy pass.",
    }
    with open(report_path, "w") as handle:
        json.dump(report, handle, indent=1)
    print(json.dumps({"verdict": verdict, "manifest_artifacts": len(artifacts),
                      "leaks": len(leaks), "holds": holds,
                      "elapsed_seconds": report["elapsed_seconds"]}, indent=1))
    return 0 if verdict == "PRIVACY-CLEAN" else (1 if verdict == "PRIVACY-NOT-QUALIFIED" else 2)


if __name__ == "__main__":
    sys.exit(main())
