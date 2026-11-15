#!/usr/bin/env python3
"""Read native Duo outer-display geometry; run inside ios_guard.py.

Requires an expanded Reader on --title, with the requested Drawer open.
--rail-start is measured from UIKit, not inferred from the device width.
Geometry is NOT painted-title or touch-delivery acceptance. See duo-chrome.md.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "kit"))
import ax


def inspect(tree, args):
    nodes = [node for node, _, _ in ax.walk(tree)]

    def find(label, kind=None):
        found = [n for n in nodes if n.get("AXLabel") == label
                 and (not kind or n.get("type") == kind)]
        if not found:
            raise RuntimeError("Missing native element: " + label)
        return min(found, key=lambda n: ax.frame(n)[1])

    root = next(n for n in nodes if n.get("type") == "Application")
    width = ax.frame(root)[2]
    if not 0 < args.rail_start < width:
        raise RuntimeError("The measured rail start must be inside this window")
    mx, my, mw, mh = ax.frame(find("More actions", "Button"))
    if min(mw, mh) <= 0:
        raise RuntimeError("More actions has no usable native frame")
    title = ax.frame(find(args.title, "Heading"))
    checks = {
        "more_in_system_rail": mx + mw / 2 >= args.rail_start,
        "title_near_usable_top": 0 <= title[1] <= args.max_title_top,
    }
    values = {"windowWidth": width, "railStart": args.rail_start,
              "more": {"x": mx, "y": my, "width": mw, "height": mh}, "title": title}
    if args.surface == "actions":
        x, _, w, _ = ax.frame(find("Share", "Button"))
        gap = width - (x + w)
        checks["actions_no_reserved_side_strip"] = 0 <= gap <= args.max_share_gap
        values["shareRightGap"] = gap
    else:
        dx, _, dw, _ = ax.frame(find("Dictionary"))
        tx, _, tw, _ = ax.frame(find("Translation"))
        gx, _, gw, _ = ax.frame(find("Sheet Grabber", "Button"))
        # The centred heading container, not the segmented control's own ink:
        # the SwiftUI Picker sizes to its intrinsic width and draws leading in
        # the box DrawerTitle centres on the sheet, so the RadioButton union
        # sits a few points off however well the drawer is centred. The box is
        # the Group that hosts both segments and is strictly wider than their
        # union; measuring it detects the inherited rail strip the proxy
        # existed for (ios-qa-01, 2026-11-15: host 68/330 centred on the
        # grabber at 233, union 225 — 8 from the Picker's intrinsic width).
        ux, uw = dx, (tx + tw) - dx
        dict_y = ax.frame(find("Dictionary"))[1]
        hosts = []
        for n in nodes:
            if n.get("type") != "Group":
                continue
            fx, fy, fw, _ = ax.frame(n)
            if abs(fy - dict_y) < 1 and fw > uw + 2:
                hosts.append((fx, fw))
        if not hosts:
            raise RuntimeError("No heading host group wider than the segments")
        hx, hw = min(hosts, key=lambda one: one[1])
        centre = hx + hw / 2
        checks["lookup_heading_centred_on_sheet"] = abs(centre - (gx + gw / 2)) <= 4
        values.update(lookupHeadingCentre=centre, sheetGrabberCentre=gx + gw / 2,
                      lookupHeadingHostWidth=hw, segmentedUnionCentre=(ux + uw / 2))
    return {"outcome": "PASS" if all(checks.values()) else "FAIL",
            "scope": "Duo outer/right rail, ordinary text; geometry only",
            "checks": checks, "values": values}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("udid")
    parser.add_argument("out", type=Path)
    parser.add_argument("--surface", choices=["actions", "lookup"], required=True)
    parser.add_argument("--rail-start", type=float, required=True)
    parser.add_argument("--title", default="Shadow Slave 1-250")
    parser.add_argument("--max-title-top", type=float, default=20)
    parser.add_argument("--max-share-gap", type=float, default=32)
    parser.add_argument("--tree", type=Path, help="replay a saved native tree without device access")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    try:
        tree = json.loads(args.tree.read_text()) if args.tree else ax.read_tree(args.udid)
        (args.out / "tree.json").write_text(json.dumps(tree))
        report = inspect(tree, args)
    except (OSError, ValueError, RuntimeError, StopIteration, SystemExit) as error:
        report = {"outcome": "BLOCKED", "reason": str(error)}
    (args.out / "result.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return {"PASS": 0, "FAIL": 1, "BLOCKED": 69}[report["outcome"]]


if __name__ == "__main__":
    sys.exit(main())
