# A fast scroll that jumps by whole chapters and shows an empty page (#58)

`fling-jump.cjs` flings the open reader with real flicks and reads, on every
animation frame, which section and which offset within it is at the top of the
viewport and how much of the viewport displayed sections cover. It also logs
every call epub.js makes that changes what lies above the viewport, and the
scroll it adjusts with: `trim`, `erase`, `prepend`, `counter`, `scrollTo`,
`scrollBy`. Add a real book (**Real books** in [../README.md](../README.md)) and open it, with this
worktree's Metro writing to METRO_LOG, then:

```sh
node test/manual-test/scrolling-and-theme/fling-jump.cjs SIMULATOR_UDID METRO_LOG down 3
node test/manual-test/scrolling-and-theme/fling-jump.cjs SIMULATOR_UDID METRO_LOG up 3
FLINGS=1 FROM_END=1200 node test/manual-test/scrolling-and-theme/fling-jump.cjs SIMULATOR_UDID METRO_LOG down 3
node test/manual-test/scrolling-and-theme/fling-jump.cjs --read OUT_DIR/run-….json
```

- The single flick is the smallest red case, and is `INCONCLUSIVE` whenever
  only one section lay above the one it left: epub.js keeps the section just
  above the first it displays, so nothing is erased (2026-09-24 05:54).
- Each run resets the page to a fixed section (`START`, 20 going `down` and 60
  going `up`), waits for epub.js's queue to empty, and flicks through
  `fling-jump.sh`, which builds `FlingProbe.swift` once into `OUT_DIR` and
  runs `FlingProbe.testFlicks` without rebuilding. `FLINGS` (10), `VELOCITY`
  (4000 pt/s), `GAP` (0.1 s) and `NOWAIT` pass through; the flicks do not wait
  for the app to go idle between them (Pitfalls, XCTest).
- It stops the probe only when the page has rested for a second and the queue
  is idle, and reads the log the WebView posts to a server the script runs on
  127.0.0.1 (Pitfalls, **Measuring inside the reader's WebView**).
- A run is `RED` on any blank frame (sections covering under half the viewport)
  or jump (the text at the top moving half a viewport further than the page's
  own recent speed could carry it, just after an epub.js scroll or unlike the
  scroll position's own step; or landing in no section either frame held);
  `GREEN` only when the top crossed a section boundary and epub.js changed
  something above the viewport; `INCONCLUSIVE` otherwise. Each red episode is printed with the call it followed. `VIDEO=1`
  records each run for `white-flash.py`, whose empty-dark count is the same
  blank seen on the screen.

Measured 2026-09-24 on a dedicated iPhone 17 simulator (iOS 27.0) with "My
Vampire System 1-250": before #58's change, `down` red 4 of 4 (7–21 blank
frames), `up` red 4 of 4 (182–248, reaching 12 to 28 sections back), a single
flick from 1,200 px before a section's end red 3 of 3; every episode followed an
`erase` of a section above, or a `counter` for sections prepended in a bounce.
After it: every run that reached rest green, with the erases above all made at
rest, and red again in both directions with the program's install line
`holdStill(rendition.manager);` commented out. Ten flicks back without a pause
stop at section 59, the top of the laid-out text, by design (design 0045);
`GAP=0.8` reaches 56. About 30 s a run.

What it cannot show: the physical iPhone, a finger that stops the page and
holds still (XCTest's press here lasts 0.01 s), or what happens during
playback, which it never starts.
