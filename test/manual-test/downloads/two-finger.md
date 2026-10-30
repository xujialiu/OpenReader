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

The drawer is the SwiftUI sheet, whose chapter list is a scroll view of its own inside it. Rows scrolled out of that
list stay in the accessibility tree with frames outside it, above the header or below the footer, so a row chosen by a
screen constant or by the header and footer can be clipped out of view and a two-finger path started on it touches the
header, not a chapter (#334). The `testDrawer…` methods therefore take `drawerViewport` (the smallest scroll view that
holds a chapter row's centre) and use only rows fully inside it, as `DrawerRow` snapshots (an `XCUIElement` found by index
is looked up again at every use, so a row read later may be another one) touched by point. `shownRows(_:atLeast:)` and
`choosableRun` return nothing, and the method prints `UNVERIFIED` and fails, when there is no viewport or too few
choosable rows in a row; callers stop on that, since a failed assert does not.

`testDrawerValidGestures` checks, on rows fully inside the viewport, that a path's start, turn and end points lie on them
before the gesture and that `Download selected (N)` reads back after: rows 0 to 2 choose 3; rows 0 to 3 and back to 2 in
one gesture choose 3 (down alone would give 4); a tap on another row and a tap back keep the 3. It runs on a fresh launch
for the first presentation (the runner terminates the app after a failed run, so launch it again with
`-RCT_jsLocation localhost:PORT` and `silence.sh set` before each) and then again after Back from Download and Download,
with the same geometry printed both times (`VIEWPORT`, `ROWS`, `GESTURE` and `DRAWER` lines). At the half-height drawer
the viewport is 386 x 204 pt and four 49.9 pt rows fit. Run every method with `-collect-test-diagnostics never`: the print
lines still reach `test.log` and a failed run does not then sit in `simctl diagnose`.

`testDrawerShortSweeps` is the phone's rule (a run is every row from the start row to the current one) for sweeps that
end within a row of where they began, each on a fresh presentation: 0 to 1, 0 to 2 and back to 1, 0 to 2 and back to 0
(1), 0 to 3 and back to 1, 1 to 3 and back to 2, and ends 10 and 40 pt below row 0's bottom edge or 10 and 30 pt above
row 3's top edge. A row's `Pressable` keeps the touch that came down on it and its press retention reaches about 20 pt
above and 30 pt below the row, so without `SweepController.guard` (`use-sweep.tsx`) the lift fired the start row's press
and toggled the row the sweep had chosen. The guard drops a row's press when a sweep began since a finger last came down on
a row, which each list cell reports through `onTouchStart`; a tap after a sweep comes down afresh and goes through, which
the taps of `testDrawerValidGestures` check. The Library shares the guard but did not lose its start row even without it
(`LibraryTwoFingerProbe.testShortSweepKeepsStartRow`, `../library-and-reader/library-two-finger.md`).

`testDrawerScrollKeepsChosen` checks that a one-finger scroll keeps the chosen rows, at first presentation and after a
remount. At the half-height drawer the sheet takes an upward drag of the list at its top before the list does: a slow
drag (154 pt in 0.6 s) leaves both the rows and the viewport as they were, and a longer, faster one (to y 250 in 0.35 s)
expands the sheet, to a 402 x 578 pt viewport, with the list still at its top; the next drag then scrolls the list. So the
method drags slowly, and when neither the rows nor the viewport changed it drags to expand, asserts the viewport grew,
and drags again, asserting the rows changed and the 3 chosen stay chosen. The detent persists across Back and Download,
so the remount phase starts expanded and its first drag scrolls. XCTest's `swipeUp()` also expands the sheet, so it is
not used between steps of a comparison; the geometry then differs.

The guard's other direction (an independent verification of `1.0.3 (22)-beta24`, 2026-10-31; a guard that swallows an
ordinary tap fails as much as a lost start row does). Run each method after a fresh launch of the app:

- `testDrawerOneFingerTapToggles`: a plain tap chooses and unchooses row 0 with no sweep before it.
- `testDrawerTapsAfterShortSweeps`: the short paths 0 to 2 and back to 0, 10 pt below row 0 and 10 pt above row 3, each
  followed by a one-finger tap on a row the sweep did not choose and a tap on its start row, in both orders, 0.15 s or 1.5 s
  after the lift. `Download selected (N)` is read after every tap against a model of the chosen rows (30 reads on Debug, all
  equal). The first of these taps is the first touch after the sweep.
- `testDrawerTapWithin120msOfSweep`: the same taps as a third finger inside the sweep's own event record, down 0.12 s after
  the two fingers lift. A separate `tap` call lands about 0.1 s after it is made, on top of any sleep, so it cannot time a
  gap of a few hundred ms; a guard that refused presses for 300 ms after a sweep (the first version) would drop these.
- `testDrawerStaggeredLifts`: the same paths with the second finger lifting 0.15 s after the first, either one last. The pan
  ends when the first lifts, so the lone finger's press is what reaches the row afterwards: the counts stay 1, 2 and 2 and
  the next tap still chooses.
- `testDrawerFoldArrows`: needs `Nested Volumes Fold Check` (`../fixtures/nested-volumes-fixture.ts`, added through the
  harness) in the Library; it launches, opens that book and its drawer. The volume's arrow is a Pressable inside the row's
  own accessible one, so it is not in the AX tree and is tapped by point (`row.maxX - 66`); fold state is read from every row
  in the tree, since a reopened volume's chapters sit below the viewport, rendered but clipped, and the volume's row moves
  when its chapters leave. A tap on the arrow folds and unfolds with no sweep before it, after the short sweep 0 to 2 and
  back to 0, and after 0 to 2, without changing what is chosen.
- `testDrawerSweepThenStay` is a setup step for the accessibility-activation check below: the short sweep 0 to 2 and back to
  0, then nothing, so no finger has come down on a row since the sweep.

Measured 2026-10-31 on `iPhone 17 probe334` (iOS 27.0, 402 x 874 pt), Debug against Metro 8334 and the embedded Release build,
each run `Executed 1 test, with 0 failures`: `testDrawerShortSweeps` (9 of 9 cases as the rule gives), `testDrawerValidGestures`
and `testDrawerScrollKeepsChosen` (first presentation after a fresh launch, then the remount), `testDrawerOneFingerTapToggles`,
`testDrawerTapsAfterShortSweeps` (30 of 30 reads equal their model), `testDrawerTapWithin120msOfSweep` (6 of 6),
`testDrawerStaggeredLifts` (6 sweeps 1, 2, 2 as the rule gives, 6 following taps) and `testDrawerFoldArrows` (the first
arrow tap folds and the second unfolds in all three cases, with the chosen count unchanged). The rows' `=0` flags in the
`DRAWER … rows=` lines are not the checked state (`.isSelected` reads 0 for every checkbox row); the count in `chosen=` and the
tree's `value: checkbox, checked` are.

**Accessibility activation after a sweep** (the guard is told by touches, so a press with no touch of its own would be dropped).
Voice Control, Switch Control and VoiceOver cannot be driven here (the simulator has none to run, and the Device Hub's
VoiceOver switch was left alone), but a press by accessibility can: Xcode 27's Device Hub exposes the simulated app's
elements to macOS accessibility, and `orca computer click --app pid:PID --window-id ID --element-index N` performs `AXPress` on
one in the background (`path: accessibility`; Device Hub is not in `list-apps`, so select it by pid; select the device in its
sidebar; each iOS element is listed twice; indexes change after every action). Setup: `testDrawerSweepThenStay` (the drawer after
0 to 2 and back to 0: `Download selected (1)`) or `LibraryTwoFingerProbe.testLibrarySweepThenStay` (selection mode, `1 selected`),
nothing touched since. Then an `AXPress` on another row, on the embedded Release build: the drawer's `Chapter 1: Nightmare
Begins` went to `Download selected (2)` and the Library's `Innkeeper` to `2 selected`, and on a fresh app `AXPress` on
`Innkeeper` opened the reader. The press passed the guard, so a touch came down on a row after the sweep: RN's
`accessibilityActivate` (`RCTViewComponentView.mm`) returns NO without `onAccessibilityTap`, which the app never sets, and
`Pressability` reaches `onPress` only through the responder system or an `onClick` that carries no `pointerType`, which iOS
emits only with pointer events (`RCTSurfacePointerHandler.mm`). It says nothing of the real assistive technologies themselves.

What it cannot establish: that a real hand does the same — a real finger
trembles, flicks and lands 20–40 pt apart, where these are two exact paths 36 pt
apart; Files' top edge band (a hold over its search field could not be read
back); how the drawer behaves past a 3 s hold, given the synthesis limit above;
and a collapsed volume's sweep behaviour on a device, since no book in
`~/Works/epub_books` has a nested contents list to sweep (checked 2026-09-24:
every part's `toc.ncx` is one flat level) — `range-selection.test.ts` is the
only coverage of that rule.
