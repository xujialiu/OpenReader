# iPad rotation and actual window resizing (#319)

Read the kit's admission/readiness and silence rules first. Use a session-owned
iPad with the latest universal binary and a Document open. Rotation alone is
not width-reflow evidence: on a 13-inch iPad both orientations can keep the
reader's 800-point cap.

## System rotation

```sh
bash test/manual-test/kit/run-probe.sh IpadRotationProbe SIMULATOR_UDID OUTPUT_DIR \
  -only-testing:IpadRotationProbe/testRotateToLandscape
```

Use `testRotateToPortrait` for the other direction. The probe neither launches
nor terminates the app. It asserts device orientation only: inspect the app's
own frame and content afterward. An iPhone deliberately stays portrait even
when the device orientation changes. Check the before/after orientation too:
setting landscape when already landscape is not a rotation.

## A real narrow window

Use the system resize handle visible at the app window's bottom-right corner.
A screenshot establishes its current screen coordinates; divide pixels by the
simulator's scale (2 on the tested 13-inch iPad). AXe's `drag` can operate that
handle even though it has no target in the app's accessibility snapshot.

```sh
# AXE is the bundled axe binary located by kit/ax.py. Coordinates are screen
# points from the current screenshot, NOT a copied app-relative AX frame.
"$AXE" drag --udid "$SIMULATOR_UDID" \
  --start-x "$CORNER_X" --start-y "$CORNER_Y" \
  --end-x "$END_X" --end-y "$END_Y" --duration 1
node test/manual-test/kit/hx.cjs "$SIMULATOR_UDID" '{}' \
  --code-file test/manual-test/place-and-following/viewport-size.js
```

Read the `[probe]` answer from the app's Debug Log after it flushes. Assert the
native window is actually narrower, the viewport and stage reflect that width,
and every displayed iframe has the same width. Wait for reflow before judging
a screenshot taken during the native animation. A 375-point stage containing
an 800-point iframe is a failure, even if some Body Text has rewrapped.

Before resizing a Browsing page, send `resize-anchor.js` the same way. Its
first call keeps the upper viewport's CFI; repeat after resizing to measure
that SAME character's top, not a newly chosen post-resize anchor. It must be
near the upper visible edge, below the navigation bar, not merely somewhere
inside the viewport. Reset between scenarios with a harness `js` command whose
code is `delete window.__openReaderResizeProbe; return 'reset';`.

Repeat larger and smaller, with a Browsing passage and then a bounded Reading.
Check the passage near the top, Following, saved Reading Position, Drawer close
and preview, and the Player's narrow layout separately. Keep each playback
only as long as its named check needs; pause before inspecting results.

## Limits and evidence

- A frame from AX can be relative to a floating app window. A ref-based tap
  reported success on an app-relative point outside that window in the #319
  run. Confirm the next screen, or use current screenshot-derived screen
  points; a successful input dispatch is not a successful press.
- Preserve all raw `test-*.log` files, failed ones included, and verify their
  `Executed ... failure` lines and actual orientation actions.
- Sampled cue numbers can establish monotonicity only within their sampled
  interval. Split at every deliberate seek; they do not prove that every
  sentence was played exactly once. A fixture without Word Timings is not a
  word-highlight test.
- This is iPad runtime evidence, not validation on an Apple silicon Mac.

## Finishing #319, beta9 (1.0.1 (14)-beta9-debug) (2026-10-23)

Session iPad 13 b319 (iOS 27.0, `768F798A-1713-4E25-98F9-6F0E4CC6C8C3`), unchanged
native 1.0.1 (14), beta9 JS cold-loaded from Metro 8219, real Document
`9d9f03aa` "Shadow Slave 1-250", reading paused, no audio (zero `playing=true`
lines). Records and screenshots: `/tmp/openreader-319-ios-01/final-beta9/`.

- **wide→narrow→wide keeps the same anchor at the upper edge.** Anchor captured
  once at 800×1272 (`/6/32!/4/2/2/1:0` top 97.5) survived both corner drags:
  top 54.5 at 375×476 (stage = both iframes 375), then top 54.5 at 800×1262
  (iframes 800). beta8's failure shape (`/116/1:70` top 234.5 after the same
  gesture) did not reproduce.
- **One drag delivers several resizes, all reusing the retained CFI.** The
  Debug Log shows two `asked by onResized` displays for the single cancel-test
  drag. A new Browsing choice (`section 18`) then a drag kept the NEW passage
  (`/6/36!/4/2/220/1:0` top 54.5 at 375) — no snap-back to the old anchor.
- **A clamped section-end anchor could not be staged with synthetic scrolls.**
  Scrolling `manager.scrollBy` to the scroll limit between resizes leaves the
  retained CFI in force (a synthetic scroll is not a user gesture), and the app
  re-applies it — three resize starts from the clamp each redisplayed the
  retained `/…/4/2/2/1:0` (section start), not the staged end-region character
  (`/6/34!/4/2/134/1:27` at top 26.5 before each drag, top 3872.5 after). The
  ADR's contract is that only a user touch, wheel, key, new Browse or Return
  makes a later position the next anchor; the end-region case with a real
  gesture therefore stays open, and a staged `scrollBy` position must not be
  read as a deliberate position. The clamped case at narrow (beta8's pass,
  top 54.5 at width375) was not repeated.
- **Return by a real touch on M.** `ax.py find "Return to the reading"` gives
  the frame LOCAL to the floating window; add the window offset read from the
  current screenshot (here +(331, 390)) and send `axe touch -x -y --down --up
  --delay 0.2`. The page redisplayed section 14 (the reading's section), the M
  row left the collapsed player, `playing=false` throughout.
- The saved Reading Position and stamp (`1792756329299`) were re-read unchanged
  after every scenario.
