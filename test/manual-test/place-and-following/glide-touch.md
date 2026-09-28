# A real drag during a live glide (#71, `glide-touch.cjs`, `GlideTouchProbe.swift`)

```sh
node test/manual-test/place-and-following/glide-touch.cjs SIMULATOR_UDID METRO_LOG arm
bash test/manual-test/place-and-following/glide-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR
node test/manual-test/place-and-following/glide-touch.cjs SIMULATOR_UDID METRO_LOG analyse
```

`line-follow.cjs` proves the program's own side of ADR 0050 with a synthetic
click; it cannot touch the one thing only a real finger can, a `touchmove`
landing on the page. This pair does. `arm` installs a recorder independent of
`line-follow.cjs`'s own — its own global, `window.__glideTouch`, safe to run in
the same session either before or after it — collapses and expands the player
once for the inset, and starts recording the same per-frame `scrollTop`/word-
line/Utterance-middle series, plus a capture-phase `touchmove`/`touchend`
listener added to every section document as it renders (additive only; nothing
the app itself listens for is touched). `glide-touch.sh` then runs
`GlideTouchProbe.testDragDuringLiveGlideStopsThenRecovers` (same shape as
`kit/run-probe.sh`: a new output directory generates the project, an existing
one reuses it) — a real tap on Play, a wait for the first Clip's cue (the
`Pause` button's own `busy` state clearing), a further wait (`DRAG_DELAY_MS`,
`/tmp/openreader-glide-touch-params.txt`, `KEY=VALUE`, default 2000 —
`xcodebuild … test` does not pass the caller's environment, Pitfalls below), a
small real drag (`press(forDuration:thenDragTo:)`, about a tenth of the
window, comfortably past the WebView's 10 px `DRAG_PX`), a further wait while
still playing, then Play-pause-Play. `analyse` stops the recording and prints
every line change matched against the `scrollTop` episode that followed it (or
`NO EPISODE`), plus every real touch event's own timestamp on the same
`performance.now()` clock the frames use, so a touch can be lined up against
exactly the episode it interrupted. The same `arm`/`analyse` pair, driven by
plain harness commands instead of the probe (a `section` far from the
reading's own while paused, then `play`; or `play` then a `settings` Font Size
patch), is what verified the far-jump and live-Font-Size-change behaviour
below — no dedicated script was needed for either.

- **Timing the drag to land inside a live ~220 ms glide from outside the
  WebView is hard, and usually misses.** `DRAG_DELAY_MS` is measured from the
  cue, but the cue-to-first-line-change gap itself varies with the sentence
  and the network. Across three real runs (2026-09-26) at 1700, 1400 and
  800 ms the drag twice landed in the ~1–2.3 s gap between glides (once
  158 ms after the preceding glide ended, once 1137 ms before the next line
  change) and once landed so that a line change fell **inside** the drag's own
  native-scroll window with no glide at all — the strongest of the three: a
  `rest` of `-23.2` where a followed line always reads `0.8`, i.e. the page
  visibly did not follow that word. Do not tune for a single perfect hit;
  three runs is enough to see the pattern (a clean glide before, an unmatched
  native-scroll episode timestamp-bounded by the touch and resting nowhere
  near the target, one or two `NO EPISODE` line changes after, a clean glide
  again after Play-pause-Play) and report exactly what each run landed on
  rather than claim a mid-curve truncation no run actually caught.
- **An unmatched episode's `rest` is the tell, not just whether it matched.**
  A finger's own drag-scroll and a halted program glide can both surface as an
  "other" episode; a program glide always rests within about a pixel of the
  target (`0.8` throughout this book), and a finger's own scroll rests
  wherever the finger let go — `-59.2`, `-53.2`, `-23.2` in the three runs. A
  `steps` list that does not decay the way `glideLeft` does (`[10,10,4,5,5,5,
  4,4,4,4,3,2]` against a real drag versus `[2,3,2,2,2,2,1,2,1,1,1,1]` for a
  glide) is the same tell from a different angle.
- **A jump across several sections can arrive as three or four discrete
  corrections, not one.** Browsing to a section far from the reading and
  pressing Play, `analyse`'s episode grouping (frames merged across gaps under
  three still ones) printed one "line" entry of `2904 px` in `111 ms` for a
  Font Size change mid-Play (a single quantised frame — genuinely one step,
  confirmed by asking the WebView for `R.frames` in that window directly), but
  `-1384 px` in `464 ms` for a far-section return. Reading the raw frames
  (`R.frames.filter(...)`) showed four discrete jumps 74–305 ms apart
  (`-3840`, `+2698`, `-262`, `+20`) — `display()` resetting scroll and
  `settle()` placing every frame until three need no move, exactly as ADR 0050
  describes, merged by the grouping because none of the gaps reached three
  still frames. Neither shows the glide's signature (many small decaying
  steps over a fixed ~220–260 ms); telling "one instant nudge" from "a few
  settle frames" apart needs the raw per-frame query, not just the printed
  episode.

What this does not establish, beyond `line-follow.cjs`'s own list: the exact
frame a live glide's animation is truncated on, since no run actually landed
mid-curve.
