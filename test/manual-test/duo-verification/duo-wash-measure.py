#!/usr/bin/env python3
"""#350 red-loop wash/handle measurement (pinned constants only).

Reads a calibration JSON ({"wash":[r,g,b], ...}) written BEFORE any fold test
and never tuned from outcomes. op=shares: wash/ink shares for one crop box in
an oriented image, plus saturated-blue handle-dot clusters when dots=true.
Whole-frame mode (box=null) supports the range-dropped case where no
selection rect exists to register a crop against; its paint thresholds are
derived from the pre-test baselines (unpainted whole frame measured 0.0000; a
fully washed word contributes ~0.0016-0.0021 of the 2852x2006 inner frame).

Usage: duo-wash-measure.py CMD_JSON
CMD_JSON: {"image":PATH, "box":[x,y,w,h]|null, "wash":[r,g,b], "tol":N, "dots":bool}
"""
import json
import sys

import numpy as np
from PIL import Image


def measure(cmd):
    img = np.array(Image.open(cmd["image"]).convert("RGB")).astype(int)
    box = cmd.get("box")
    dots_wanted = bool(cmd.get("dots"))
    if box is None:
        crop = img
        region = img
        dots_wanted = False
    else:
        x, y, w, h = box
        crop = img[y : y + h, x : x + w]
        pad = 60
        y0, y1 = max(y - pad, 0), min(y + h + pad * 2, img.shape[0])
        x0, x1 = max(x - pad, 0), min(x + w + pad * 2, img.shape[1])
        region = img[y0:y1, x0:x1]
    lum = crop.mean(axis=2)
    ink = lum < 120
    nonink = ~ink
    dist = np.abs(crop - np.array(cmd["wash"])).sum(axis=2)
    washmask = nonink & (dist <= cmd["tol"] * 3)
    out = {
        "mode": "whole" if box is None else "crop",
        "cropPx": box,
        "inkShare": round(float(ink.mean()), 4),
        "washShare": round(float(washmask.mean()), 4),
        "washMedian": [int(v) for v in np.median(crop[washmask], axis=0)] if washmask.any() else None,
    }
    if dots_wanted:
        blue = (region[:, :, 2] > 180) & (region[:, :, 0] < 120) & (region[:, :, 1] < 170)
        ys, xs = blue.nonzero()
        clusters = 0
        if len(xs):
            pts = list(zip(xs.tolist(), ys.tolist()))
            used = [False] * len(pts)
            for i, p in enumerate(pts):
                if used[i]:
                    continue
                clusters += 1
                stack = [i]
                used[i] = True
                while stack:
                    j = stack.pop()
                    for k, q in enumerate(pts):
                        if not used[k] and abs(q[0] - pts[j][0]) <= 6 and abs(q[1] - pts[j][1]) <= 6:
                            used[k] = True
                            stack.append(k)
        out["handleBluePx"] = int(blue.sum())
        out["handleClusters"] = clusters
    return out


def main():
    print(json.dumps(measure(json.load(open(sys.argv[1])))))


if __name__ == "__main__":
    main()
