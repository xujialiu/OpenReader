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
the next one.

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
