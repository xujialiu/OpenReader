# The page follows the line being spoken (#71, `line-follow.cjs`)

```sh
node test/manual-test/place-and-following/line-follow.cjs SIMULATOR_UDID METRO_LOG SECONDS [--tap]
node test/manual-test/place-and-following/line-follow.cjs SIMULATOR_UDID METRO_LOG --skips N
node test/manual-test/place-and-following/line-follow.cjs SIMULATOR_UDID METRO_LOG --whole
```

Prerequisites: a reader open and paused inside a chapter, a Provider with Word
Timings and a Voice chosen (Fish: see "A Fish Voice chosen through the
harness"), the simulator silenced, and METRO_LOG, the file this tree's Metro
writes to. The script records `scrollTop` and the word highlight's first line
box on every animation frame inside the WebView, collapses and expands the
player once so the bridge sends its inset, sets the Line Position through the
harness (`POSITION`, percent, default 50) so the bridge sends that too — the
target is then the program's own, `(h − open player) × share` (#71, batch 2;
`inset` stands in until the open player's height is known) — plays for SECONDS
and pauses, and prints one line per change of the word's line:
when the page began to move, how far, for how long, the longest frame in it,
each frame's step, and where the line came to rest against the target.

- **Getting into a chapter.** `{"do":"section","section":5}` moves the page there
  while paused, and it is Browsing; then point the reading at a sentence on the
  screen with a synthetic click in the section document (the `tap` code in the
  script) or a `skip`. `{"do":"seek","utterance":N}` moves the reading and **not
  the page** — it is not revealed — so the first Play after it glides, or jumps,
  from wherever the page was.
- **SECONDS.** Fish took up to 5.6 s to answer the first request of a run, and a
  line of `Cultivation Online` takes 2–3 s at 1.00×, so 18 s gives three line
  changes; a run that gets fewer is RED for that reason alone.
- **`--skips N`** plays nothing: while paused it skips a sentence (or
  `SKIP_TARGET`, e.g. `next-paragraph`) N times a second apart, and reports the
  glides and every change in the number of views. A trim needs two hidden
  sections above: from Utterance 185 of `Cultivation Online 2001-2044`, 35 skips
  reached one (2026-09-26 01:42).
- **`--whole`** skips to a sentence at least 50 px tall and hands the program
  that sentence again as a Clip without Word Timings. It proves the page's side
  of that case, not a real Provider's.
- **`DURING=collapse`** collapses the player a third of the way into the play and
  expands it at two thirds; **`DURING=note`** puts a note on the player a third of
  the way in (a `js` answer is one) and leaves it. Both show in the `msg` lines as
  `inset bottom … open …`: `bottom` moves, `open` must not, and nothing should
  scroll at those moments (2026-09-26 11:06–11:08).
- **Notes are always there.** Every `ask` answer stays on the player as a note
  while paused, so each run starts with the player taller than its open height,
  and a Play clears it. That was how batch 1's inset-based target was caught
  (87 px moved at Play). It is also why a paused skip is the way to show that
  a note moves nothing: the `other move` lines print `its first line rest`, the
  Utterance's first line against the target, which is what a sentence shown
  while paused is held by.

GREEN (exit 0): at least three line changes with a move, each beginning at most
two drawn frames after its word (or up to 300 ms before it, at the cue of a
sentence that begins a paragraph), lasting 150–400 ms, and resting within 1.5 px
of the target. Measured 2026-09-26 (notes): one frame's delay, 233–252 ms, rests
0.1–0.5 px.

What it cannot prove: a finger. It moves nothing by touch, so the glide stopping
under a finger (any `touchmove`) is not covered, and neither is the feel — look
at the simulator, or the owner's phone.

```sh
node test/manual-test/place-and-following/line-follow.cjs SIMULATOR_UDID METRO_LOG arm
( a real XCTest touch drives the player: player-touch.sh's
  testCollapseAndReopenDuringPlaybackRealTouch, or a bare harness play/pause
  with no settings patch in between — see below )
node test/manual-test/place-and-following/line-follow.cjs SIMULATOR_UDID METRO_LOG analyse
```

`arm`/`analyse` (#71 batch 2), the same split `glide-touch.cjs` uses: `arm` runs
this script's own calibration (collapse and expand once for the inset, the
`POSITION` Line Position, the silence check) and starts the recorder, then exits
without pressing Play; `analyse` only reads `window.__lineFollow` back, with no
GREEN/RED verdict of its own since what drove the player in between was not this
script. Needed whenever the thing under test is the **player's own controls**
(collapsing, reopening) rather than the WebView: a real collapse/reopen tap
never touches the WebView, so `line-follow.cjs`'s normal single-process run,
which only ever presses Play itself, cannot see it.

Also proved item 5 of #71 batch 2 (a note on the player must not move the page
at Play): `arm` at the Line Position already in effect (so the bridge sends no
`following` message — a real change is its own legitimate move, measured
separately above) leaves a note (every `ask()` answer is one), then a bare
harness `play`/`pause` with nothing in between. Measured 2026-09-26: `msg` line
`note attention=true "The highlight could not be drawn: PROBE started …"`
present immediately before `play`, and the run's `other` array empty — no
unmatched move at Play, where batch 1 moved 87 px. The same run's real-touch
half ([player-touch.md](../player-and-reading-held/player-touch.md)) independently shows the same thing: `arm`'s own note was still
showing when `testCollapseAndReopenDuringPlaybackRealTouch` pressed Play by
touch, the `inset` message right after it dropped `bottom` from 174.67 to
134.67 (the note clearing), and there is still no unmatched move there either.
