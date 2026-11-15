#!/usr/bin/env python3
"""Compare the same title's painted ink against a qualified complete capture.

Native frames alone miss a zero-height navigation background painting over the
title. Requires Pillow, matching title/font/theme and native trees for both
screens. This checks ink retention, not input, wrapping or selection continuity.
"""
import argparse
import json
import math
from pathlib import Path
import sys

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "kit"))
import ax


def ink(shot, tree_path, title, dark):
    nodes = [n for n, _, _ in ax.walk(json.loads(tree_path.read_text()))]
    width = ax.frame(next(n for n in nodes if n.get("type") == "Application"))[2]
    titles = [n for n in nodes if n.get("type") == "Heading" and n.get("AXLabel") == title]
    if not titles:
        raise ValueError("No native title frame")
    rect = ax.frame(min(titles, key=lambda n: ax.frame(n)[1]))
    image = Image.open(shot).convert("L")
    scale = image.width / width
    x, y, w, h = rect
    box = (math.floor(x * scale) - 3, math.floor(y * scale) - 3,
           math.ceil((x + w) * scale) + 3, math.ceil((y + h) * scale) + 3)
    pixels = image.crop(box).getdata()
    count = sum(v > 160 if dark else v < 96 for v in pixels)
    return count, rect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("reference_tree", type=Path)
    parser.add_argument("current", type=Path)
    parser.add_argument("current_tree", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument("--title", default="Shadow Slave 1-250")
    parser.add_argument("--dark", action="store_true")
    args = parser.parse_args()
    try:
        before, reference_rect = ink(args.reference, args.reference_tree, args.title, args.dark)
        after, current_rect = ink(args.current, args.current_tree, args.title, args.dark)
        if before < 100 or any(abs(a - b) > 1 for a, b in zip(reference_rect[2:], current_rect[2:])):
            raise ValueError("Reference ink or matching title dimensions are not qualified")
        ratio = after / before
        report = {"outcome": "PASS" if ratio >= .95 else "FAIL",
                  "referenceInk": before, "currentInk": after, "retainedFraction": ratio}
    except (OSError, ValueError, StopIteration) as error:
        report = {"outcome": "BLOCKED", "reason": str(error)}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return {"PASS": 0, "FAIL": 1, "BLOCKED": 69}[report["outcome"]]


if __name__ == "__main__":
    sys.exit(main())
