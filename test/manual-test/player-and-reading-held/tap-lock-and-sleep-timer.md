# The Tap Lock and the Sleep Timer (#325, #326)

The Player's head row: the Tap Lock beside A or M, the Sleep Timer beside the
collapse arrow (ADRs 0087 and 0088). First run 2026-10-26 on an iPhone 16 Pro, iOS 27.0,
1.0.2 (18)-beta1-debug; what it met is in the README's **Pitfalls**, under
"Verifying #325/#326".

## Setup

A Debug build, the fake Kokoro (`fake-kokoro.cjs 8832`) as the Provider, and a
real book with a Contents and links in its text (a part from
`~/Works/epub_books`). Wait for `say` to print `chapterOffered=true` before a
chapter test: it is false until the page reports the spine.

## Tap Lock

Harness: `{"do":"taplock","on":true}`; `say` prints `tapLock=…`. Real touches:
`ax.py touch 'Lock Taps'` / `'Unlock Taps'`, read back from the tree each time.
Tap text and a link with `ax.py`, locked and unlocked, open and collapsed, and
read `[reading] seek to utterance N` in the Debug Log: a locked tap writes none.
A drag still turns A to M; a long press still opens a lookup.

## Sleep Timer

The menu is SwiftUI's own, which AXe and mobilebuildmcp taps do not open.
`SleepMenuProbe.swift` opens it with an XCTest tap and chooses an entry by
title:

```sh
TEST_RUNNER_SLEEP_ITEM='5 Minutes' TEST_RUNNER_SLEEP_EXPECT='Sleep Timer, 5:00 left' TEST_RUNNER_SLEEP_EXPECT_EXACT=1 \
  bash test/manual-test/kit/run-probe.sh SleepMenuProbe SIMULATOR_UDID OUT_DIR -only-testing:testChooseMenuEntry
```

`TEST_RUNNER_SLEEP_CAPTURE=1` attaches the screen after the choice. It plays
nothing. A failed run terminates the app (`run-probe.sh`), so restage before
the next one. Closing the open menu without choosing taps outside it:
`testOpenSleepMenu`'s default dismissal point is the page above the menu
(`0.5, 0.30`; pass `TEST_RUNNER_SLEEP_DISMISS_X`/`TEST_RUNNER_SLEEP_DISMISS_Y`
to the runner to override it). On iOS 26.5 a
tap on the reader's title bar (`0.5, 0.05`, the dismissal the probe used
before) left the menu open until the wait timed out (2026-10-27); changing only
the outside-tap location to the page dismissed it first try. The recordings
establish that gesture difference, not which native view consumed the tap.

For the length path without waiting minutes, the harness takes a fraction:
`{"do":"sleep","choice":0.1}` is 6 s. The Debug Log then says
`[reading] sleep timer: stop after sentence`, `the Sleep Timer paused the
reading after utterance N`, `stop after nothing`, and the next Play's first cue
is N + 1. For the chapter, seek a few sentences before a Contents row's last
one, choose `When Current Chapter Ends`, Play, and expect the pause after that
sentence and Play then starting the next row. With the device locked,
`kit/lock-device.sh SIMULATOR_UDID lock-on SIGNAL` (a work directory of your
own) and a 0.2 length: the `LOCKPROBE pressing at` time must come before the
pause line.

What it cannot prove: the audio a person would hear at the boundary; the
engine's own tests (`test/playback/engine-stop-line.test.ts`) pin that nothing
past the line is queued.

## The moon drops when the Player opens (#331)

`player-opening.cjs` drives the real Player's collapse/expand handlers through
CDP, records the native screen, then runs `player-opening-measure.py`. It never
plays audio. Prerequisites: a session-owned 402×874-point, 3× iPhone simulator
(for example iPhone 17), a connected Debug app, dark Theme, default text size,
and an open Document with the Player expanded, paused, without notes and with
the Sleep Timer off. Use a fresh output directory on every run.

```sh
OPENREADER_METRO=http://127.0.0.1:METRO_PORT \
  python3 test/manual-test/kit/ios_guard.py run --timeout 45 \
  --record OUT_DIR/phase.json -- \
  node test/manual-test/player-and-reading-held/player-opening.cjs \
  SIMULATOR_UDID OUT_DIR 3
```

The final argument is the number of collapse/expand cycles (1–9, default 3).
The output keeps `open.mp4` and its 60 fps `frames/`. The analyser matches the
moon and lock against their settled white-ink silhouettes, excluding the page's
text. It fails if the moon moves more than 3 pt relative to the lock, or if the
lock is visible without a matching moon. Exit 0 is PASS, 1 is a visual failure,
and 2 is a setup/measurement failure. The unfixed Player moves the moon -22 pt
relative to its settled position for the first one or two frames of every open,
then back to 0.

This is a handler-driven native-pixel check, not a physical-touch or menu-choice
test. It measures the transient against the settled layout, not that layout's
absolute correctness. Its crops are specific to this width, text size, theme
and timer-off state; larger text, other widths, countdown text, menu choices
and touch targets require separate checks. Re-sampling the recording at 60 fps
can duplicate frames, so frame counts alone are not precise native timings.

`player-first-open.cjs` gives the same check to the first Document opening, not
only the collapse/reopen cycles: it closes the reader with the walkthrough
harness's own `shut`, records while `open` re-enters the Document, then runs
the same analyser.

```sh
OPENREADER_METRO=http://127.0.0.1:METRO_PORT \
  python3 test/manual-test/kit/ios_guard.py run --timeout 120 \
  --record OUT_DIR/phase.json -- \
  node test/manual-test/player-and-reading-held/player-first-open.cjs \
  SIMULATOR_UDID OUT_DIR sha256:DOCUMENT_ID
```

Frames before the head row first appears (Library, transition) are not
comparable and are skipped; the verdict covers every frame from its first
appearance, so a hidden moon on the first frame fails the run. It is still the
app's own navigation, not a physical-touch test.

For other shapes — another width, an enlarged text size — `player-opening.cjs`
takes `OPENREADER_MEASURE` (with `OPENREADER_MEASURE_ARGS`) to swap the
analyser while keeping the same handler drive and recording.
`player-jump-check.py` is that analyser: it templates two glyphs of the row
from the settled last frame, so it needs their point boxes instead of assuming
the 402-point dark default layout. Read the boxes off the accessibility tree's
head-row frames, with the anchor (the lock, which never moves) and the mover
(the moon, or the countdown) each alone in its box and page text excluded:

```sh
OPENREADER_METRO=http://127.0.0.1:METRO_PORT \
OPENREADER_MEASURE=test/manual-test/player-and-reading-held/player-jump-check.py \
OPENREADER_MEASURE_ARGS='POINTS_WIDTH LOCK_BOX MOON_BOX [--shift 30]' \
  python3 test/manual-test/kit/ios_guard.py run --timeout 120 \
  --record OUT_DIR/phase.json -- \
  node test/manual-test/player-and-reading-held/player-opening.cjs \
  SIMULATOR_UDID OUT_DIR 3
```

Its verdict is the original's (±3 pt, no hidden mover, exit 0/1/2). It shares
the original's limit: it measures the transient against the settled layout,
not that layout's absolute correctness, and its boxes are specific to the
measured shape — read new boxes for every new width or text size. Its white-ink
mask assumes the dark Theme. `--shift` and the displacement verdict are in
points; the crop displacement converts them to screenshot pixels. The first
version of the generic analyser added points directly to pixel coordinates:
at 3× it reported a 2 pt move as 6 pt and searched only 10 pt for `--shift 30`.
The scale check below failed before that correction and covers 1×, 2× and 3×
images, including the original 22 pt jump:

```sh
python3 test/manual-test/player-and-reading-held/test_player_jump_check.py
```

### Verified correction: 1.0.3 (21)-beta1-debug

App code `509090a`: the inner face uses the Player's supplied width and height,
not flex-fill sizing. Independent `ios-tester` verification used iOS 26.5;
the parent re-read every XCTest run and recomputed the pixel verdicts from the
retained frames after correcting the generic analyser's point/pixel units.

| Scenario | Comparable frames | Displaced / missing moon |
| --- | ---: | --- |
| 402 pt, default text, 3 collapse/reopens | 188 | 0 / 0 |
| 402 pt, first Document opening | 107 | 0 / 0 |
| 402 pt, accessibility-large, 3 collapse/reopens | 183 | 0 / 0 |
| 390 pt, default text, 3 collapse/reopens | 183 | 0 / 0 |

All four measured 0 pt movement relative to the lock. The same corrected
analyser still fails the retained original-code recording: -22 pt on every
open (5 displaced sampled frames of 190 comparable frames).

Eleven native XCTest runs include one failed title-bar dismissal and ten
passing runs after the gesture correction described above. Choices of
5 Minutes, Turn Off Timer and When Current Chapter Ends worked; default,
accessibility-large and 390 pt checks retained their supplied touch bounds.
The large-text countdown was readable and centred. No audio was played.

Limits: native pixels are handler/navigation-driven; only menu checks use
XCTest taps. The enlarged tier was accessibility-large, not every accessibility
size; first-open at that tier, rotation, physical iPhone and audio behavior
were not tested. The speed control is unchanged and outside this fix.
