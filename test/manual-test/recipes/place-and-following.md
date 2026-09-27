# The reading place and the page following it

## Reading across the end of a downloaded chapter, and a place kept across a renumbering (#26, #45, #46)

`boundary-fixture.ts` writes `Boundary Fixture.epub`: two chapters in two spine
files, a heading and four sentences each, all different, so Utterances 0–4 are
chapter one and 5–9 chapter two.

```sh
npx tsx test/manual-test/boundary-fixture.ts OUTPUT_DIRECTORY
```

Load it like any fixture (**Real books** above). Download chapter one alone,
without the sheet, through the app's own runtime; it synthesizes that chapter's
five sentences for real, and nothing plays:

```sh
node test/manual-test/download-chapter.cjs DOCUMENT_ID "Boundary Fixture" fish VOICE_ID --list
node test/manual-test/download-chapter.cjs DOCUMENT_ID "Boundary Fixture" fish VOICE_ID nav.0
```

`VOICE_ID` is the app's own id, locale first (`en/<model id>` for Fish): a bare
model id is refused as an unknown voice. The same script downloads a chapter of a
real book, which is how the #46 runs below had Chapter 2003 of `Cultivation
Online 2001-2044` saved and Chapter 2004 not.

**#26 at the boundary.** The failure needs a connection that has idled for more
than about 60 s but that iOS has not yet closed: measured 2026-09-23, it failed
107 s and about 70 s after the last request to `api.fish.audio` and not about
3 min after (`notes/NOTES_2026-09-23.md`). So restart the app (its launch asks
Fish for voices, which is the last request), wait 90–100 s with the reader open,
seek to Utterance 3 and play: chapter one's last two sentences come from disk in
about 0.1 s each, and the requests for 5 and 6 are what is being tested. Before
the fix both failed after about 6.4 s and the reading stopped on chapter two's
heading. Stop as soon as Utterance 6 has started or the reading has stopped.

**#45.** With a reading paused mid-chapter, the harness's `breakfetch` on
`api.fish.audio` refuses every request from the one named, and `unbreakfetch`
lifts it (`src/app/walkthrough-harness.ts`). Play until the reading stops on a
refused sentence with at least two refused, lift the refusal, press Play once:
the reading must go past all of them.

**#46.** On a real book, choose a chapter in Contents whose predecessor has not
rendered, or leave a book with its place in a middle chapter and open it again.
Before the fix the status line became `utterance=null` with "The document
rendered its sections out of reading order…", and Play read the book's first
page. The Library's stored place is in `Documents/library.json`, or in the
harness's `{"do":"shelf"}` answer.

What none of it proves: whether the owner's phone meets #26 at all, which
depends on its own network path, or anything about real touches.

## Play with the page scrolled away, and a place on a chapter heading (#50, #51)

**#50.** `follow-probe.cjs` measures the page from the moment Play is pressed:
every scroll, every display, every section adopted, every problem the program
posts, and then where the two highlights are:

```sh
node test/manual-test/follow-probe.cjs SIMULATOR_UDID METRO_LOG SECTION [SECONDS]
```

Prerequisites: a reader open, the reading **paused on a sentence of spine item
SECTION after its Clip has started**, the simulator silenced, and METRO_LOG, the
file this tree's Metro writes to. On `Cultivation Online 2001-2044`, go to that
place with `{"do":"section","section":6}` followed by thirteen
`{"do":"skip","target":"next-paragraph"}`, which lands on "Suddenly, a golden
energy surged…" (Block 6.13). Then play until the status line reads
`level=word`, and pause. The script scrolls up 1,500 px at a time until SECTION
is off the page, checks the silence, plays for SECONDS (default 2.5), reads, and
pauses.

GREEN (exit 0) means no problem was posted and the Utterance's highlight lies
between 0 and the container's height. Measured with the fix on 2026-09-23: the
section's content hook at +17 ms, epub.js's `moveTo` +958 px at +20, the
centring −281 px at +29, and the Utterance at 283..342 of 758. Before the fix
the same run read the Utterance at −724..−665 and the problem "Block 6.13 is in
section 6, which is not on the page". For the variant after a renumbering
(#46), reopen the book on that sentence instead of jumping there: the scroll up
reports sections 5, 4 and 3 above the paused reading, and the result must be
the same.

**#51.** On the same book: `{"do":"section","section":20}`, then `shut`.
`Documents/library.json` now holds `epubcfi(/6/42!/4/2/2/2)`, "Chapter 2018:
Entering the Starry Sky", with no prefix or suffix. Open the book again. With
the fix, the status line reads `section=20` and "Resumed at the sentence the
reading stopped on.", and the heading is highlighted on Chapter 2018. Before
the fix it read `section=2`, the contents page's line, and "The paragraph this
book was left in is not where it was…".

What neither proves: a real touch on the Player or on the page, since both go
through the harness; or a section that is slow to load. In the runs with the
fix, every section arrived within 20 ms of its display. The first run, before
the fix, took 585 ms, and nothing since has repeated that.

## A Contents row while paused only moves the page (#52)

`browse-probe.cjs` makes the call a Contents row makes,
`{"do":"section","section":N}`. It checks that the page went there and that the
reading did not follow:

```sh
node test/manual-test/browse-probe.cjs SIMULATOR_UDID METRO_LOG SECTION [WAIT_MS]
```

Prerequisites:

- A reader open and paused, with the reading on a sentence that is its Reading
  Position. A book reopened on its stored place will do, as will a
  `{"do":"seek",...}` (a tap), a skip, or a Play and pause.
- METRO_LOG, the file this tree's Metro writes to.

It plays nothing, so it needs no Provider and no silence. It reads the status
line, the Library's place for the book (`shelf`), the views, the section at the
top of the page and every painted highlight Range, sends the row, waits
(default 2,500 ms), reads again and takes a screenshot beside METRO_LOG.

GREEN (exit 0) means all of these:

- the section at the top of the page is SECTION;
- the status line's Utterance and section are unchanged;
- the stored place is unchanged;
- no Utterance Range is painted that was not painted before;
- no word is lit.

RED (exit 1) names each failure. Before the fix, on 2026-09-23 at 23:19, the
run read "the reading moved: utterance 176 -> 423; the stored place changed;
the highlight moved to "Chapter 2012: Grand Sword Crater"". Exit 2 is a
precondition or a harness that did not answer.

Choose SECTION two after the reading's. Its display re-renders the reading's
own section as a neighbour, which is how the WebView used to take the page
back: 23:30 in `notes/NOTES_2026-09-23.md`, and ADR 0044. A far section tests the
React Native half alone. With a Provider:

- Run it after a Play and a pause, so that an engine is paused. With
  `{"do":"watchfetch","host":"api.fish.audio"}` on first, the log shows that a
  browse sends no synthesis request.
- The speed (`{"do":"rate",...}`), a Voice (`{"do":"voice",...}`) and the
  Appearance (`{"do":"settings","patch":{"appearance":...}}`) changed while
  browsing must leave the section at the top of the page.
- Play must bring the page back to the paused sentence at its first cue.

What it cannot prove: a real touch on a Contents row, or a finger dragging the
page, which the WebView also counts as browsing. Both need XCTest.

### Real touches on a Contents row, a sentence and a drag (`BrowseTouchProbe.swift`, #52)

Independent #52 verification, 2026-09-24, of what `browse-probe.cjs` cannot
touch: a real tap on the Contents button and a real chapter row, a real tap on
a sentence, and a real finger drag. `browse-touch.sh` has the same shape as
`scroll-theme-reader.sh` — a new output directory generates the project, an
existing one reuses it, `-only-testing:` takes the bare method name, and it
checks the simulator's own volume before anything runs, because three methods
press Play:

```sh
bash test/manual-test/browse-touch.sh SIMULATOR_UDID /tmp/openreader-browse-touch-01 \
  -only-testing:testOpenBookThenBrowseTwoChaptersAhead
```

A companion host script reads the same facts `browse-probe.cjs` does —
without sending the `section` command itself — so a real touch's effect can
be diffed the same way, run from the shell right before and right after each
method:

```sh
node test/manual-test/browse-touch-state.cjs SIMULATOR_UDID METRO_LOG LABEL
```

Run the methods in this order — each depends on where the previous one left
the reading or the page, and none of them relaunches the app except the
first (see Pitfalls, the debug banner):

- `testOpenBookThenBrowseTwoChaptersAhead` — opens `Cultivation Online` (real
  tap, resuming its stored place), confirms paused, then a real tap on
  Contents and on the chapter row two ahead of the one marked current. The
  state script confirmed the page alone moved (section 20 → 22), the status
  line, the stored place and the painted highlight all unchanged. Never
  presses Play.
- `testPlayAfterBrowseReturnsAtFirstCue` — a real Play tap; stops the instant
  the Pause button's own `busy` accessibility state clears (the first Clip's
  cue), 10.6 s in the recorded run — Fish Audio's real first-clip latency, the
  shortest this fact can be observed in. The state script read the reading
  back at the paused Utterance, its highlight centred at 283..341 of the
  container.
- `testTapSentenceInBrowsedChapterThenPlays` — browses again, then a real tap
  on a sentence well below the heading (`bodyPoint`, 0.55 down the page, clear
  of a freshly browsed chapter's own title). The tap moved the Utterance,
  its highlight and the stored place to the tapped sentence; a brief real Play
  (3.1 s to the first cue) then read from it.
- `testDragAwayFromReading` / `testFontSizeWhileBrowsing` /
  `testDragBackToReadingSection` — four `swipeUp(velocity: .fast)`, a real
  Font Size increase and decrease from Appearance, then `swipeUp`/`swipeDown`
  back. Never presses Play. The state script, taken after the away-drag, after
  the font change and twice more (immediately and 2.5 s later) once the drag
  back had crossed into the reading's own section, showed the same top
  section and — once back — the identical painted highlight Range across the
  2.5 s gap: no snap-centring, immediate or delayed, and the highlight was
  still there, off the visible page until a further nudge brought it on.
- `testContentsRowWhilePlayingJumpsAndKeepsPlaying` — a real Play tap, then a
  real Contents row two chapters ahead while it plays. The reading jumped to
  the target's heading and kept playing (Pause still showing 1.5 s later);
  7.9 s Play-to-Pause in the recorded run.
- `testOpenUnreadBook` / `testUnreadBookContentsRowHighlightsHeading` /
  `testLeaveUnreadBookWithoutPlaying` — opens `Cultivation Online — Chapters
  1751–2000` (never played) for the first time, a real Contents tap on its
  third chapter row, then a real tap on Back. The heading highlighted and the
  reading moved for this session, but the Library's place for this book id
  read `null` both right after the choice and after leaving —
  `Documents/library.json` read directly, not only the harness echo — and the
  Library row still read "Not started." afterwards. Never presses Play.
- `testSettingsShowsVersion`-equivalent coverage is `settings-version.sh`
  (`SettingsVersionProbe`), reused rather than duplicated: it reads
  `APP_VERSION` from the working tree at run time, so it needed no change for
  beta14.

What it does not establish: whether the debug-banner precaution
(`app.terminate(); app.launch()` at the sequence's start) is still needed once
nothing else in a run logs a warning; a shorter method sequence was not tried.
`BrowseTouchProbe.swift` is in `test/manual-test/ios/project.rb`'s allow-list.

## The page follows the line being spoken (#71, `line-follow.cjs`)

```sh
node test/manual-test/line-follow.cjs SIMULATOR_UDID METRO_LOG SECONDS [--tap]
node test/manual-test/line-follow.cjs SIMULATOR_UDID METRO_LOG --skips N
node test/manual-test/line-follow.cjs SIMULATOR_UDID METRO_LOG --whole
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
node test/manual-test/line-follow.cjs SIMULATOR_UDID METRO_LOG arm
( a real XCTest touch drives the player: player-touch.sh's
  testCollapseAndReopenDuringPlaybackRealTouch, or a bare harness play/pause
  with no settings patch in between — see below )
node test/manual-test/line-follow.cjs SIMULATOR_UDID METRO_LOG analyse
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
half (below) independently shows the same thing: `arm`'s own note was still
showing when `testCollapseAndReopenDuringPlaybackRealTouch` pressed Play by
touch, the `inset` message right after it dropped `bottom` from 174.67 to
134.67 (the note clearing), and there is still no unmatched move there either.

## A real drag during a live glide (#71, `glide-touch.cjs`, `GlideTouchProbe.swift`)

```sh
node test/manual-test/glide-touch.cjs SIMULATOR_UDID METRO_LOG arm
bash test/manual-test/glide-touch.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR
node test/manual-test/glide-touch.cjs SIMULATOR_UDID METRO_LOG analyse
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
`browse-touch.sh`: a new output directory generates the project, an existing
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

## The Following mark, the way back, the collapsed lock, and Continuous (#71 batches 3/4, `FollowingProbe.swift`, `hx.cjs`, `continuous-follow.cjs`)

Verifies design 0050/ADR 0050 batches 3 (A/M, the way back, the collapsed
lock) and 4 (Continuous) against this merge of main's #67 (the floating bar
and Reading Button) and #68 (the Reading held in the Library) into #71.
Needs a real book already on the shelf, well underway (this session used
"Cultivation Online" from `~/Works/epub_books`, already past section 20 of
48), Fish's "Laura" (Word Timings) the chosen Voice, and the app running
against this tree's Metro.

`hx.cjs` is a small generic harness sender the other scripts here lacked:

```sh
node test/manual-test/hx.cjs SIMULATOR_UDID '{"do":"say"}'
node test/manual-test/hx.cjs SIMULATOR_UDID '{"do":"settings","patch":{"following":{"scrolling":"continuous","linePosition":50}}}'
```

One JSON command, no `SECONDS`/mode arguments to get right — useful for the
setup/inspection half of any manual run (Pitfalls above: `following` is
patched as a whole object, both fields, every time, or the other one goes
back to `undefined`).

`FollowingProbe.swift` (`test/manual-test/following-touch.sh`, the same
`ManualTests.xcodeproj`/`LockScreenProbe` scheme shape as every other probe
here) holds two general-purpose methods driven by
`/tmp/openreader-following-params.txt` (`KEY=VALUE`, `SyncProbe.param`'s
convention) — `testDragPageByParams` (a drag or, with `VELOCITY` set, a
fling) and `testTapControlByParams` (`WHAT=A|M|Play|Pause|Collapse|
ShowPlayer|Contents|BodyText|ContentsAfterCurrentPlus:N`) — plus one bespoke
method per scenario batches 3/4 needed: fresh-open-before-any-Play (#53),
drag-then-return and Contents-then-return while paused, near/far drag then
M-tap while playing, the collapsed lock's full sequence, the Scrolling menu,
a Library round trip changing Line position and Scrolling live, the
Continuous drift stopping under a finger, and the automatic recovery rule
(two versions — see the Pitfalls above for why the second, Contents-based
one replaced the first). Every method is independent; run one at a time
with `-only-testing:testName`, since which state a given scenario needs
(paused/playing, By line/Continuous, collapsed/expanded) differs across
them and `.activate()` inherits whatever the previous run left.

`continuous-follow.cjs` is `line-follow.cjs`'s counterpart for Continuous's
own per-frame drift shape (step sizes, intervals, glides, rests), reusing an
independent recorder under `window.__continuousFollow` the same way
`glide-touch.cjs` keeps its own beside `line-follow.cjs`'s:

```sh
node test/manual-test/continuous-follow.cjs SIMULATOR_UDID METRO_LOG 20      # 1.0x
node test/manual-test/continuous-follow.cjs SIMULATOR_UDID METRO_LOG 10 2   # 2.0x, restores rate 1 after
```

Needs Continuous already chosen (it does not choose it); sends `play`,
waits SECONDS, `pause`s, and prints the drift step/interval distributions,
any glides (a run of 8+ consecutive moving frames covering 15+ px — the
Pitfalls above explain why not a time-gap grouping) and rests (12+ still
frames). Measured 2026-09-26: at 1.0×, 1170-1238 frames over ~22 s, drift
steps 1-4 px (median 1 px), intervals median 92-100 ms, 2 glides at
217-302 ms (rate 0.093-0.115 px/ms) and 12 rests of 183-534 ms; at 2.0×, 703
frames over ~12 s, the same 1-4 px steps, intervals roughly halved (median
50 ms — the drift's cadence follows the words, not its step size), 3 glides
at 217-234 ms (rate ~0.115-0.12 px/ms, not rate-scaled: a glide is a fixed
animation length) and 3 rests of 350-1130 ms.

Item 9's trim check reused `line-follow.cjs`'s own `arm`/`analyse` (its
`views` field does not care which scrolling mode is active): a genuine
continuous-playback window crossing one section boundary (utterance
175→227, section 23→24, over about five real minutes at this book's pace —
"derive the time from section length" was not a fast derivation here, this
book's sections are long) recorded zero `views` changes at all, and a
follow-up `--skips 45` run (Continuous still selected) forced one in
seconds: `views 8263 3->4 moving` then `views 23739 4->3 moving`, the trim
itself a single 16 ms frame (`-4090 px in 16 ms`) sitting between two
ordinary skip-glides that both rested within a pixel of target — the text
did not visibly move. Item 9's fling check reused the existing
`fling-jump.cjs SIMULATOR_UDID METRO_LOG down N` (#58) unmodified: 6 of 7
runs GREEN under Continuous, 1 RED (a blank+jump matching the pre-#58
signature exactly); a same-day, same-position comparison under By line was
3 of 3 GREEN. `FlingProbe` never plays, so Continuous's own drift mechanism
was inactive throughout every one of these runs regardless of which
scrolling mode was selected, which is why this reads as the
already-documented class of gesture/timing flakiness in this probe rather
than a Continuous-specific regression — reported to the implementing agent
as a finding worth a slightly larger sample, not as a confirmed defect.

## The review fixes: a pause, a re-cue, a Block crossing (#71, `follow-fixes.cjs`)

```sh
node test/manual-test/follow-fixes.cjs SIMULATOR_UDID METRO_LOG pause 15
node test/manual-test/follow-fixes.cjs SIMULATOR_UDID METRO_LOG recue
node test/manual-test/follow-fixes.cjs SIMULATOR_UDID METRO_LOG paragraph 12
```

Needs the reader open and paused, a Voice with Word Timings, and the simulator
silenced; it chooses nothing in Settings, so set Scrolling first with `hx.cjs`
(pause and paragraph are Continuous's). Its recorder, `window.__followFixesV2`,
logs every drawn frame's `scrollTop`, every message the highlighter is sent
(with a speak's Utterance, `reveal`, `recover` and first Block), and every A/M
the program posts, on one clock, and re-wraps the program on every arm. `pause`
is GREEN when nothing moved after the `hold`; `recue` puts the page in M with
the program's own `browse` message once a second sentence has begun, changes
the speed (and puts it back), and is GREEN when the re-cue moved nothing and
posted no A before the next Utterance; `paragraph` lists every run of moving
frames. Measured 2026-09-26 15:57–16:02 (notes).
