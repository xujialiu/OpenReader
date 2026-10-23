#!/usr/bin/env python3
"""Paused exact-CFI resize regression. Run inside ios_guard.py; no audio.

The document must already be open. Supply CURRENT screen-point handle drags;
staging uses the app's browse message, but width changes are native AXe input.
See ipad-window.md. Captures the same character before/narrow/wide, not a newly
chosen location after resizing. The output directory must not already exist.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("device")
    parser.add_argument("output", type=Path)
    parser.add_argument("--cfi", required=True)
    parser.add_argument("--section", type=int, required=True)
    parser.add_argument("--axe", type=Path, required=True)
    parser.add_argument("--metro", required=True)
    parser.add_argument("--narrow", nargs=4, type=int, required=True, metavar=("X", "Y", "TO_X", "TO_Y"))
    parser.add_argument("--wide", nargs=4, type=int, required=True, metavar=("X", "Y", "TO_X", "TO_Y"))
    args = parser.parse_args()
    if not args.cfi.startswith("epubcfi(") or args.section < 0:
        parser.error("Use an EPUB CFI and nonnegative section index")
    args.output.mkdir(parents=True, exist_ok=False)
    records = []

    def run(*command):
        return subprocess.run(command, cwd=ROOT, text=True, capture_output=True,
                              check=True, timeout=35).stdout

    data = Path(run("xcrun", "simctl", "get_app_container", args.device, "top.xujialiu.openreader", "data").strip())
    logs = data / "Library/Application Support/debug-log"

    def position_hash():
        entries = json.loads((data / "Documents/library.json").read_text())["entries"]
        positions = {entry["id"]: entry.get("position") for entry in entries}
        return hashlib.sha256(json.dumps(positions, sort_keys=True).encode()).hexdigest()

    def paused():
        env = dict(os.environ, OPENREADER_METRO=args.metro)
        state = json.loads(subprocess.run(["node", "test/manual-test/kit/reading.cjs", "state"], cwd=ROOT,
                                          env=env, text=True, capture_output=True, check=True, timeout=20).stdout)
        if state.get("playing") is not False:
            raise RuntimeError("The Reading must be paused before and after this check")

    def probe(code):
        token = "RESIZE319-" + uuid.uuid4().hex
        body = "return " + json.dumps(token + " ") + "+JSON.stringify((function(){" + code + "})());"
        run("node", "test/manual-test/kit/hx.cjs", args.device, json.dumps({"do": "js", "code": body}))
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            for file in sorted(logs.glob("debug-log-*.txt"), reverse=True):
                for line in reversed(file.read_text().splitlines()):
                    if "[probe] " + token + " " in line:
                        result = json.loads(line.split(token + " ", 1)[1])
                        records.append({"line": line, "result": result})
                        print(line, flush=True)
                        return result
            time.sleep(0.2)
        raise RuntimeError("No matching probe reply in the Debug Log")

    def measure(label):
        directory = ROOT / "test/manual-test/place-and-following"
        anchor = (directory / "resize-anchor.js").read_text()
        geometry = (directory / "viewport-size.js").read_text()
        result = probe("const anchor=(function(){" + anchor + ";return JSON.parse(probe());})(); " +
                       "const size=(function(){" + geometry + ";return JSON.parse(probe());})(); return {anchor,size};")
        run("xcrun", "simctl", "io", args.device, "screenshot", str(args.output / (label + ".png")))
        return result

    def at_top(result, width):
        anchor, size = result["anchor"], result["size"]
        if anchor["cfi"] != args.cfi or not anchor["onPage"]:
            raise AssertionError("Measured a different or absent character")
        if size["stage"]["width"] != width or not size["views"] or any(view["width"] != width for view in size["views"]):
            raise AssertionError("Stage/displayed iframe widths do not match: " + json.dumps(result))
        # The current app's visible header is 54pt. Record actual character
        # height, allowing two lines rather than accepting anywhere on screen.
        if not 45 <= anchor["top"] <= 54 + 2 * anchor["lineHeight"]:
            raise AssertionError("Same character is not at the upper visible edge: " + json.dumps(result))

    def drag(label, points):
        run(str(args.axe), "drag", "--udid", args.device, "--start-x", str(points[0]), "--start-y", str(points[1]),
            "--end-x", str(points[2]), "--end-y", str(points[3]), "--duration", "1")
        time.sleep(3)  # Do not measure the native animation; the assertions decide.
        return measure(label)

    try:
        paused()
        before = position_hash()
        run("bash", "test/manual-test/kit/silence.sh", "set", args.device)
        probe("window.__openReaderHighlighter({kind:'browse'}); window.__openReaderResizeProbe=" +
              json.dumps({"cfi": args.cfi, "section": args.section}) + "; rendition.display(" +
              json.dumps(args.cfi) + "); return 'browse-staged';")
        time.sleep(2)
        # Place the specified character before native resizing, as a deliberate
        # Browse. The final browse message releases any earlier retained anchor.
        probe("const c=rendition.getContents().find(c=>c.sectionIndex===" + str(args.section) + "); " +
              "if(!c)throw Error('Section not ready'); const y=c.document.defaultView.frameElement.getBoundingClientRect().top+" +
              "c.locationOf(window.__openReaderResizeProbe.cfi).top-rendition.manager.container.getBoundingClientRect().top; " +
              "rendition.manager.scrollBy(0,y-54,false); window.__openReaderHighlighter({kind:'browse'}); return {preparedY:y};")
        time.sleep(1)
        at_top(measure("before-wide"), 800)
        at_top(drag("narrow", args.narrow), 375)
        at_top(drag("wide", args.wide), 800)
        paused()
        if position_hash() != before:
            raise AssertionError("Paused Browsing changed a saved Reading Position")
        records.append({"savedPositionUnchanged": True, "playing": False})
        print("PASS: exact CFI at the upper edge through native 800/375/800 widths; positions unchanged, paused.")
    finally:
        (args.output / "records.json").write_text(json.dumps(records, indent=2))


if __name__ == "__main__":
    main()
