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


def subtree_has(root, label, kind=None):
    return any(node.get("AXLabel") == label and (not kind or node.get("type") == kind)
               for node, _, _ in ax.walk(root))


def ancestor_chain(tree, label, kind):
    """The node chain from the tree root to the first element with this label."""
    def descend(node, chain):
        if isinstance(node, dict):
            chain.append(node)
            if node.get("AXLabel") == label and (not kind or node.get("type") == kind):
                return True
            for child in node.get("children", []):
                if descend(child, chain):
                    return True
            chain.pop()
        elif isinstance(node, list):
            for item in node:
                if descend(item, chain):
                    return True
        return False
    chain = []
    return chain if descend(tree, chain) else []


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
        dictionary = find("Dictionary")
        translation = find("Translation")
        dx, dy, dw, _ = ax.frame(dictionary)
        tx, _, tw, _ = ax.frame(translation)
        gx, _, gw, _ = ax.frame(find("Sheet Grabber", "Button"))
        grabber_centre = gx + gw / 2
        ux, uw = dx, (tx + tw) - dx
        # Ancestry, not width alone: the heading host is the innermost Group
        # that CONTAINS both segment nodes at their own y, and the sheet
        # surface is the innermost Group ancestor of a full-width content row
        # (word/definition) below the segments. The SwiftUI segmented Picker
        # draws its intrinsic width leading inside the centred host box, so
        # its RadioButton union sits a few points off however well the drawer
        # is centred (ios-qa-01, 2026-11-15: host 68/330 and sheet 8/450 both
        # centred on the grabber at 233, union 225 — 8 from intrinsic width).
        chain = ancestor_chain(tree, "Dictionary", "RadioButton")
        hosts = [n for n in chain if n.get("type") == "Group"
                 and subtree_has(n, "Translation", "RadioButton")
                 and abs(ax.frame(n)[1] - dy) < 1 and ax.frame(n)[2] >= uw]
        if not hosts:
            raise RuntimeError("No Group hosting both segments at the segments' y")
        hx, _, hw, _ = ax.frame(hosts[-1])
        centre = hx + hw / 2
        checks["lookup_heading_centred_on_sheet"] = abs(centre - grabber_centre) <= 4
        # The sheet surface and its content width, not the segments: the
        # innermost Group ancestor of the topmost full-width content row
        # (word/phonetic/definition, below the segments) is the sheet itself,
        # and the row's own side gaps must stay symmetric — an inherited rail
        # strip would leave the surface centre and the row's right gap far
        # off while every segment could still look plausible.
        candidates = []
        for node, _, _ in ax.walk(tree):
            fx, fy, fw, _ = ax.frame(node)
            if node.get("type") == "StaticText" and fw >= uw + 40 and fy > dy:
                candidates.append((fy, node))
        if not candidates:
            raise RuntimeError("No full-width lookup content row below the segments")
        content_row = min(candidates, key=lambda one: one[0])[1]
        row_label = content_row.get("AXLabel")
        row_chain = ancestor_chain(tree, row_label, "StaticText")
        surfaces = [n for n in row_chain if n.get("type") == "Group" and ax.frame(n)[2] >= uw + 40]
        if not surfaces:
            raise RuntimeError("No sheet surface Group around the lookup content")
        sx, _, sw, _ = ax.frame(surfaces[-1])
        cx, _, cw, _ = ax.frame(next(n for n in row_chain if n.get("AXLabel") == row_label
                                     and n.get("type") == "StaticText"))
        left_gap, right_gap = cx, width - (cx + cw)
        checks["lookup_sheet_surface_centred"] = abs((sx + sw / 2) - grabber_centre) <= 4
        checks["lookup_content_no_side_strip"] = abs(right_gap - left_gap) <= 8
        values.update(lookupHeadingCentre=centre, sheetGrabberCentre=grabber_centre,
                      lookupHeadingHostWidth=hw, segmentedUnionCentre=(ux + uw / 2),
                      sheetSurface={"x": sx, "width": sw},
                      contentRow={"x": cx, "width": cw, "leftGap": left_gap, "rightGap": right_gap})
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
