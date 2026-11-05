# The Download-consistency batch on the simulator (#253, #171, #277, #172, #278)

Session 2026-11-05 22:40 → 2026-11-06 00:45, worktree `xujialiu/fix--ios-verify`
at b7ceca0 (frozen batch: f97d349, 3c10b99, fe527fd, b7ceca0), app **1.0.4
(28)-beta4**, Debug display **1.0.4 (30)-beta4-debug** (launch line: `OpenReader
1.0.4 (30)-beta4, native 1.0.4 (30), Debug Mode on, Metro bundle`). Session-owned
device `iPhone 17 dl253` (iOS 26.5, `00DAD4FE-8F9D-4680-BA1B-EBC685169D4D`),
Debug app built from the frozen tree (guarded `prebuild` + `xcodebuild
RCT_METRO_PORT=8425`, derived data `/tmp/openreader-dl253-01/dd`), Metro 8425
from the parent checkout (same SHA, clean), `fake-kokoro-two-voices.cjs` on
`127.0.0.1:8531` (1 s silent clips, `OPENREADER_FAKE_TTS_DELAY_MS=1200`),
`download-consistency-fixture.ts`'s books, Consent answered once after the
alert was read (`Send text to the server at 127.0.0.1:8531?`). Attempt directory
`/tmp/openreader-dl253-01`. Probe: `DownloadConsistencyProbe.swift`, driven by
`/tmp/openreader-dl253-01/dc-probe.sh` through the kit's Probe-Info.plist
parameter channel.

## Verified (real touches, screenshots, request counts, raw logs)

- **Working control before any fault** (Empty Parts download): Document,
  Provider, Voice and Consent verified; synthesis requests reach the fake
  (`text="Empty Parts Chapter"`, then the three sentences — 4 requests); task
  done, `1 chapter downloaded`.
- **#172** — `Empty Parts Fixture` (empty cover + chapter): after the download
  the drawer reads `1 chapter downloaded`; the chapter row carries the check;
  the cover carries none (once inspected it leaves the list at all — printed
  `DC-NOCHECK-ROW Empty Parts Fixture: listed=false checked=false`). The
  on-screen start submitted the continued task with pre-inspection values,
  logged natively: `[download] continued task submitted showing "Downloading 1
  book", 0 of 2 chapters, for "Empty Parts Fixture": not run`. `Only Cover
  Fixture` (two empty pages): `0 chapters downloaded`, no checks anywhere,
  **zero** synthesis requests. The finished states' numbers, evaluated in the
  app's own Hermes over the real saved plan/progress/tasks
  (`continuedShown`): cover+chapter → `1 of 1 chapter`, completed 1000,
  total 1000; all-empty → `0 of 0 chapters`, completed 1000, total 1000 (the
  positive minimum filled). **Platform limit**: the simulator refuses the
  BGTaskScheduler continued task (`: not run` on every submit line), so no
  Live Activity ever renders and the end-state update/finish calls are never
  reached natively; the numbers above are what the app computes and passes to
  `submitContinued`/`updateContinued`, not a Live Activity UI pass.
- **#278** — `Bracket Sentence Fixture` (chapter with `<Seven eta>`):
  downloaded, `1 chapter downloaded`, no `Selected chapters downloaded` line.
  The real Settings › General switch was toggled both ways with the drawer
  re-opened and the app relaunched in between: with a membership key the saved
  clips do not cover (catalog evidence: membership `fca3aa4d…` for the plaque
  sentence against clip `8079d82c…`), the drawer reads `0 chapters downloaded`
  with **no** `Selected chapters downloaded` line and no Resume all; when the
  clips cover the current keying it reads `1 chapter downloaded`, also without
  the line. **No automatic synthesis ever followed a settings change or a
  relaunch** (fake request count stable at 13 through every toggle and the
  relaunch). The explicit re-download fetched **only** the missing sentence
  (`text="The plaque beside the gate named Seven eta as the founding hour."`
  — one request), re-using the three saved clips.
- **#171's pause shape (control)** — `Manage Deletion Fixture`, beta-only
  download paused by its ring mid-write (`testStartAndPauseRow`): the task
  persisted **paused** with `paused=['nav.1']` and exactly 1 of beta's 6 texts
  saved (catalog: 1 ready clip), across terminate + relaunch.

## Open (not verified natively; state preserved for the parent)

- **#171** — Pause all during the final replies, the drain and the self-finish
  (`testWatchSelfFinish` exists): the timed shell-side Pause all never landed —
  an axe touch aimed at a row's centre hits the row, not the ring (the ring
  sits at row_top+39…50), and the attempt consumed the book's download; the
  fixture books are single-shot per state.
- **#277** — Delete selected on the partly saved paused chapter: the paused
  part-saved state is staged and persisted (above); the Manage/checkbox/Delete
  flow (`testManageDeleteSelected`) never ran against it — the last probe run
  failed while still on the Library after its own relaunch (the drawer-open
  navigation raced the launch; app state verified correct via the catalogue:
  task `299536d3` paused, `paused=['nav.1']`, 1 ready clip).
- **#253** — blocked reason + explicit Resume: not staged. The plan-null
  blocked path needs a queued task over a wiped plan (Delete all audio wipes
  the in-memory plan too, and the drawer's own re-request heals it); a staged
  CDP enqueue was the intended setup, with real-touch recovery.
- **#171/#253 host claims** (pending replies drain past a save-error, exact
  injected store-read failure, shared-sentence completion) remain with the
  host suites; the store-read failure could not be induced on the simulator
  at all — the repository holds one persistent SQLite connection, so external
  permission faults cannot fail live reads, and a fresh-open fault breaks the
  whole repository rather than one pass.

## Harness facts this run established (see README Pitfalls)

Xcode 27's `xcodebuild` forwards no caller environment (`TEST_RUNNER_` prefix
included, command-line form included) to the test runner — parameters must
travel the Probe-Info.plist plist channel. The incremental build does not
always reprocess the built `Info.plist` when only the parameters change, and
the incremental install can copy a fresh test binary while keeping a stale
plist (or execute a stale binary) — the run must print a build marker and the
installed files must be checked before a run's verdict is read.
