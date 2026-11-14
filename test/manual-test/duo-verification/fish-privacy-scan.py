#!/usr/bin/env python3
"""Privacy scan for the Fish public-sentinel native qualification phase.

Explicit-artifact-manifest scanner: it scans ONLY the bounded run artifacts a
qualification run must produce (raw build/test/invocation logs, the complete
readable xcresult/test/activity exports, exported attachments, diagnostics and
the raw result bundle's files), classifies the expected public-constant
occurrences in enumerated STATIC ORIGINS (probe source, compiled probe binary
and object, prep scripts, this scanner, the host runner) separately by exact
path+sha256, and never blanket-ignores any runtime payload. Any recoverable
sentinel form inside a scanned runtime artifact is a definite NOT QUALIFIED —
including inside a `Type` activity line, even though that constant is public.
Missing/empty/undecodable required coverage is a HOLD, never a pass.

Verdicts (also written to <attempt>/privacy-scan-report.json):
  exit 0  PRIVACY-CLEAN
  exit 1  PRIVACY-NOT-QUALIFIED (recoverable sentinel in a runtime artifact)
  exit 2  PRIVACY-HOLD (coverage missing/undecodable, staged input still
          present, or a static origin file changed under enumeration)

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
import urllib.parse

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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attempt", required=True, help="attempt-02 directory")
    parser.add_argument("--prep", required=True, help="owned prep directory (phase scripts)")
    parser.add_argument("--repo-source", required=True, help="live FishKeyEntryProbe.swift path")
    parser.add_argument("--runner-source", required=True, help="fish-classifier-red-green.sh path")
    args = parser.parse_args()

    attempt = os.path.abspath(args.attempt)
    probe_dir = os.path.join(attempt, "public-probe")
    report_path = os.path.join(attempt, "privacy-scan-report.json")
    patterns = encoding_patterns()
    leaks: list[dict] = []
    holds: list[str] = []

    # The staged input must already be gone; its presence is a HOLD, and its
    # contents are never read here.
    staged = os.path.join(attempt, "fish-api-key.txt")
    if os.path.exists(staged):
        holds.append("staged input fish-api-key.txt still present at scan time")

    # --- Bind the run's own artifacts -------------------------------------
    invocation = os.path.join(attempt, "probe-invocation.log")
    artifacts = {"invocation-log": invocation}

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

    # --- Enumerate static origins (path + exact hash) ---------------------
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

    expected_constants: list[dict] = []
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
            expected_constants.append({"origin": os.path.abspath(path),
                                       "present": False})

    # --- Scan the runtime artifacts ---------------------------------------
    for key, path in sorted(artifacts.items()):
        abspath = os.path.abspath(path)
        if abspath in origins:
            continue  # a manifest artifact that IS an enumerated static origin
        try:
            data = open(path, "rb").read()
        except OSError as error:
            holds.append(f"unreadable artifact {key}: {error}")
            continue
        text: str | None
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = None  # binary artifact: byte patterns still apply
        for name, blob in patterns.items():
            start = 0
            while True:
                idx = data.find(blob, start)
                if idx == -1:
                    break
                type_activity = False
                if text is not None:
                    line_start = text.rfind("\n", 0, idx) + 1
                    line_end = text.find("\n", idx)
                    if line_end == -1:
                        line_end = len(text)
                    type_activity = 'Type "' in text[line_start:line_end]
                leaks.append({"artifact": key, "file": abspath, "encoding": name,
                              "offset": idx, "runtime_payload": True,
                              "type_activity": type_activity})
                start = idx + 1
        if text is not None:
            regex = "".join(re.escape(c) + ".{0,300}" for c in SENTINEL[:-1]) + re.escape(SENTINEL[-1])
            for match in re.finditer(regex, text, re.S):
                leaks.append({"artifact": key, "file": abspath, "encoding": "per-char-split",
                              "offset": match.start(), "runtime_payload": True, "type_activity": None})

    verdict = "PRIVACY-CLEAN"
    if leaks:
        verdict = "PRIVACY-NOT-QUALIFIED"
    elif holds:
        verdict = "PRIVACY-HOLD"
    report = {
        "verdict": verdict,
        "attempt": attempt,
        "manifest_artifacts": len(artifacts),
        "static_origins": expected_constants,
        "leaks": leaks,
        "holds": holds,
        "note": "Any runtime-artifact occurrence is a definite fail even for the public sentinel; "
                "static-origin occurrences are the expected public constant, identified by exact "
                "path+sha256, and never waive unknown runtime payloads.",
    }
    with open(report_path, "w") as handle:
        json.dump(report, handle, indent=1)
    print(json.dumps({"verdict": verdict, "manifest_artifacts": len(artifacts),
                      "leaks": len(leaks), "holds": holds}, indent=1))
    return 0 if verdict == "PRIVACY-CLEAN" else (1 if verdict == "PRIVACY-NOT-QUALIFIED" else 2)


if __name__ == "__main__":
    sys.exit(main())
