# Two fingers: Files' own selection, and the download drawer's copy (#57)

`TwoFingerProbe.swift` makes two-finger drags (see **Pitfalls › XCTest**) and
`two-finger.sh` runs it. Files first needs rows to sweep: launch Files once on
the device, then

```sh
bash test/manual-test/downloads/two-finger.sh SIMULATOR_UDID stage   # 60 files in On My iPhone › Rows
bash test/manual-test/downloads/two-finger.sh SIMULATOR_UDID /tmp/openreader-two-finger-01 \
  -only-testing:TwoFingerProbe/testFilesBackTowardStart
```

The `testFiles…` methods are the measurements of ADR 0045 (notes 2026-09-24,
02:23 to 03:13); each opens Files afresh on `Rows`, switches the folder from
icons to a list through `More` › `List` if it is showing icons, sweeps, and
prints a `MEASURE` line with the rows Files reports selected (`isSelected`) and
the first row fully in view, which says how far the list scrolled (64 pt a
row). `testFilesEdgeTrembling` holds the fingers with a 1.5 pt tremble: a
perfectly still synthesized hold sometimes stopped Files scrolling at all,
which a real finger does not do. A quick start (19.2 pt every 60 ms) begins
Files' run a row late, because its recogniser fires 26–38 pt after the fingers
come down; move slower when the first row matters.

The `testDrawer…` methods need OpenReader already on a reader whose drawer has
a long list — a part from `~/Works/epub_books` (**Real books** in [../README.md](../README.md)) shows the edge
scrolling; `Shadow Slave 1-250` gives 256 rows — and they `activate` the app
rather than relaunch it, so a worktree's device stays on its Metro (launch it
with `-RCT_jsLocation localhost:PORT` from the host first). Each opens the
Download drawer afresh. `testDrawerSweeps` prints `DRAWER` lines with the
`Download selected (N)` count after each sweep: measured 2026-09-24 at 03:04, 4
for the first row to the fourth, 2 after a sweep that begins on a selected row
goes to the fourth and back to the second, 4 when one finger carries on alone,
26 after a hold past the list's bottom edge for 1 s (Chapters 16–20 then in
view), and unchanged after a one-finger drag. `testDrawerOneFingerNeverChooses`
compares `swipeUp()` with a synthesized drag (**Pitfalls › XCTest**): measured
again 2026-09-24 verifying #56/#57 together, 4 of 6 `swipeUp()`/`swipeDown()`
changed the count and 0 of 6 synthesized drags did.

Added 2026-09-24, same file: `testDrawerTopEdge` scrolls down first with a
synthesized one-finger drag, then holds at the *top* edge and requires the
shown rows to change (measured: Chapter 25–29 back up to Chapter 2–6, 29
chosen). `testDrawerLongStretchSmoothness` holds at the bottom edge for 3 s —
not longer; see **Pitfalls › XCTest** for why — and requires the shown rows to
differ from before the hold (measured: Part 1 to Chapter 72–76, 81 chosen,
`chosen` climbing 5 → 28 → 50 → 74 across a `recordVideo` capture's frames a
second apart, no stall or drop). `testDrawerOneFingerTapToggles` confirms a
plain one-finger tap still selects, then deselects, a row (via `chosenCount()`,
not `.isSelected` — **Pitfalls › XCTest**). `testDrawerCheckedRowsUnaffectedBySweep`
and `testDrawerManageSweepSelectsForDelete` need the short fixture already
downloaded (run right after `DownloadRingProbe`'s `testDownloadRingLifecycle`,
while its reader is still the active one `openDrawer` reuses): a sweep across
downloaded rows chooses nothing, and a sweep across saved rows in Manage
downloads chooses them for `Delete selected (N)`, which the method then
actually taps through — fine for this fixture, never the owner's.

Re-measured 2026-09-29 after #88/#89 (the list ref and the sweep ref are now
one, and the list spans the drawer full width), on `iPhone 17 download`
(iOS 27.0), Debug against Metro 8095 at 3386b42, fresh `Shadow Slave 1-250`
added through the harness so the drawer opens at its top with every row
choosable: `testDrawerSweeps` passed in 145.6 s — run-0-3 chose 4, after-out 4,
from-selected-0-3-1 chose 2, one-finger-0-1-then-3 chose 4, the edge hold chose
36 with `Chapter 28–32` then in view (deeper than 2024-09-24's 26; the hold is
the same), and the closing one-finger drag changed nothing (36 → 36). The
sweep survives the merged ref and the full-width rows.

The run that failed first is the trap worth repeating. The probe sweeps the
first rows shown where the drawer opens, and only chapters with no download
under way and no saved clip are choosable. Two more row kinds look like rows
but are not choosable: a completed chapter keeps its checkbox role but is
`disabled`, its label ends `, downloaded`, and a sweep chooses nothing; a
chapter inside a download that has not finished shows a ring (label
`Resume download` when the task is held) and has no checkbox at all. On a
simulator that has seen downloads, the book at the reading position can have
almost no choosable rows — on 2026-09-29 `My Vampire System 1-250` had 90
chapters done and 245 of 253 inside a held task, leaving 8 choosable chapters
and no 4 in a row — so `shownRows` came back empty, the assertion failed, and
indexing `rows[0]` of the empty array crashed the runner; xcodebuild restarted
it, ran 0 tests and then sat (the ten-minute sits in **Pitfalls › XCTest**).
Check the rows before running (`axe describe-ui`, look for `, downloaded`
suffixes and `Resume download` buttons around the open position), and run the
battery on a fresh part added through the harness (`Shadow Slave 1-250`) when
the intended book cannot show four choosable rows in a row. A failed
`XCTAssertGreaterThanOrEqual` does not stop the test: after one, indexing the
array it guarded must not follow.

What it cannot establish: that a real hand does the same — a real finger
trembles, flicks and lands 20–40 pt apart, where these are two exact paths 36 pt
apart; Files' top edge band (a hold over its search field could not be read
back); how the drawer behaves past a 3 s hold, given the synthesis limit above;
and a collapsed volume's sweep behaviour on a device, since no book in
`~/Works/epub_books` has a nested contents list to sweep (checked 2026-09-24:
every part's `toc.ncx` is one flat level) — `range-selection.test.ts` is the
only coverage of that rule.
