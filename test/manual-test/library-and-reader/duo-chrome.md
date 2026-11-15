# Duo Reader chrome and sheet width (#362)

Use the explicit owned Duo, current Debug Metro, an expanded Reader and a real Document. No Provider or playback is needed. Preserve the two imported Documents and do not change credentials. Read the shared admission/readiness rules first.

## Native geometry loop

Measure the current window and its vertical bar with the owned native-inspection helper. A 466-point outer window with a measured trailing inset of 84 has rail start 382; that is an example input, not a hard-coded device rule.

Open the requested surface through a real More actions tap or a real word selection. Save the native input receipt and resulting screen separately. Then, inside one admitted phase:

```sh
python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 90 \
  --record /tmp/THIS-RUN/actions-guard.json -- \
  python3 test/manual-test/library-and-reader/duo-chrome.py SIMULATOR_UDID \
    /tmp/THIS-RUN/actions --surface actions --rail-start MEASURED_RAIL_START
```

For Dictionary/Translation, use a new output directory and `--surface lookup`. Pass `--title` for another Document. Each output directory is new, preserving earlier failures.

The ordinary-text, outer/right-rail check requires More actions inside the measured rail, the title within 20 points of the usable top, and either Share within 32 points of the window right edge (native sheet gap plus ordinary content padding) or the lookup segments centered on the native sheet grabber. These thresholds distinguish the reported broad strip and top gap; they do not certify other poses, accessibility sizes or painted geometry.

A saved native tree can be replayed with `--tree PATH` without touching a device. Exit 0 is geometry PASS, 1 is a measured FAIL and 69 is BLOCKED/missing prerequisites. Native geometry is not proof of a delivered tap.

## Painted title control

An empty native bar can retain an opaque background that covers the title even while its accessibility frame is correct. Keep a qualified screenshot of the complete same title/font/theme and its native tree, then compare a fresh screenshot and tree:

```sh
python3 test/manual-test/library-and-reader/duo-title-paint.py \
  REFERENCE.png REFERENCE-TREE.json CURRENT.png CURRENT-TREE.json /tmp/THIS-RUN/title-paint.json
```

Requires Pillow. Use `--dark` with a qualified dark reference. The title dimensions must match and the reference must contain real ink. At least 95 percent of the reference dark/light ink must remain. This detects the observed opaque-band clipping; it does not prove arbitrary long-title wrapping, touch regions or resize continuity.

## Final acceptance

Check a real rail tap opens actions, native drag dismissal, Dictionary/Translation width and visible content, and an actual long title. Fold/rotate while the title and a sheet are open; check the title/controls follow the actual native trait and existing task state survives. Collapse/show must not resize the WebView or move the viewed passage. Use ordinary iPhone/iPad controls for regressions and distinguish Mac source review from actual Mac execution. Discard every diagnostic navigation override by a clean final launch.
