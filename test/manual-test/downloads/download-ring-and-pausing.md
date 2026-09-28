# The download ring, pausing, and Manage downloads' listed-chapters rule (#37, #38, #56)

With a fresh Library (no provider configured, no saved audio) holding only `A
Short Test of Reading Aloud`, and the Fish key staged at
`/tmp/openreader-fish-key.txt` (`chmod 600`, never printed) as in
[fresh-library-and-deletions.md](fresh-library-and-deletions.md):

```sh
bash test/manual-test/kit/run-probe.sh DownloadRingProbe SIMULATOR_UDID /tmp/openreader-download-ring-01 \
  -only-testing:testDownloadRingLifecycle
```

Real XCTest touches throughout, spending the fixture's 17 Fish utterances for
real: configures Fish Audio and chooses its first-sorting voice exactly as
`OfflineFixProbe` does, opens Download and requires `0 chapters downloaded`
with neither `Manage downloads` nor `Pause all`, selects both chapters and taps
`Download selected (2)`. Chapters are written from the top of the list down
(#56), so it waits for the first chapter's ring to read `Pause download` and
requires `Pause all` opposite `Manage downloads`. It then:

1. taps the first chapter's own ring and requires that ring alone to become
   `Resume download` while the second chapter's still reads `Pause download`,
   and no `Paused` line anywhere (three screenshots follow, `03-second-running-N`);
2. taps `Pause all` (if the second chapter has not already finished) and
   requires `Resume all` in its place, no ring reading `Pause download`, and
   still no `Paused` line;
3. opens Manage downloads while paused, where the same place holds `Delete all
   saved audio` and not `Resume all`, and goes back;
4. taps the first chapter's ring again and requires it alone to resume;
5. waits up to 60 s for `The First Chapter, downloaded`; if the second chapter
   is still paused, requires `Resume all` (the download is paused with only
   that chapter left) and taps it;
6. waits up to 90 s for `2 chapters downloaded`, with no ring and neither
   `Pause all` nor `Resume all` left, checks Manage lists both chapters as
   checkboxes, and leaves the Download drawer open on the plain view.

A ring's label says what a tap does, not which chapter it is on, so the probe
finds a chapter's ring by position: the `Pause download` or `Resume download`
button at the height of the chapter's title and to its right
(`ring(beside:)`). A second method, `testReopenDownloadDrawer`, just reopens
that same drawer on an already-downloaded fixture and leaves it open — used to
restore the final state after a separate run (such as `OfflineProbe`'s `management` mode)
has left the app elsewhere.

The first two steps race the provider: the fixture's chapters take seconds
each, and a fast connection can finish the second chapter before `Pause all`
is tapped, which the probe allows for rather than fails. Say in the report
which branch a run took. It establishes the per-chapter and whole-download
pause through real touches and screenshots; the order rules the fixture cannot
show (a chapter resumed above the one being written waits for it; adding
chapters leaves paused ones paused) are unit-tested in
`test/offline/scheduler.test.ts` and `test/offline/runtime-pausing.test.ts`.

Measured 2026-09-22, on the #38 version of this probe, whose ring paused the
whole download: the full lifecycle passed in 73.6 s including the Fish
provider setup and voice choice; the spinning-arc "preparing" phase was caught
(`Preparing selected chapter…` visible in at least one frame) but is not
guaranteed to be — the short fixture's per-chapter text is small enough to
count in well under one screenshot interval, so treat its absence in a given
run as inconclusive, not a defect, and say in the report whether that run
happened to catch it (the probe prints `SAW PREPARING TEXT BEFORE THE FIRST
RING`). The ring's accessibility tree entries are `Button` elements 24×24pt
with label `Pause download` or `Resume download` (`Continue download` before
#56; matching `SIZE` in `download-ring.tsx`); a plain chapter checkbox row is
an `Other` with `value: checkbox`, not a `Button`, so query it with
`app.descendants(matching: .any)` as the existing offline probes do, never
`app.buttons`. This does not measure highlight timing, drift, or anything
about playback, and it does not by itself prove the ring is legible against
the sheet background in Dark (a ring only renders during an incomplete
download, so checking Dark without a second real download needs either a
fresh, unfinished task or visual inspection of the saved light-mode
screenshots' contrast against the app's dark palette).

The two-chapter fixture cannot show order independent of tap order, pausing
the chapter being written leaving the *next* chapter to finish while the
paused one stays put, the ring in Manage downloads, or adding a chapter while
another stays paused — `PauseOrderProbe.swift` drives
these on a disposable five-chapter fixture instead
(`test/manual-test/fixtures/pause-order-fixture.ts`, seeded through the harness like
any fixture, never checked into the Library by the generator itself):

```sh
bash test/manual-test/kit/run-probe.sh PauseOrderProbe SIMULATOR_UDID /tmp/openreader-pause-order-01 \
  -only-testing:PauseOrderProbe/testOrderMixedAddAndRingSweep
# host-level restart between the two methods — never an in-test app.terminate()/launch()
xcrun simctl terminate SIMULATOR_UDID top.xujialiu.openreader
xcrun simctl launch SIMULATOR_UDID top.xujialiu.openreader -RCT_jsLocation localhost:PORT
bash test/manual-test/kit/run-probe.sh PauseOrderProbe SIMULATOR_UDID /tmp/openreader-pause-order-02 \
  -only-testing:PauseOrderProbe/testOrderAfterRestart
```

Chapters one and two are tapped in reverse order and left untouched, so which
finishes first is the order proof — a ring's own accessibility label carries
no fraction, only halted or not, so it cannot show which in-task chapter is
actually being written this instant (measured 2026-09-24: chapter one, tapped
second, finished first every time). Chapters four and three (tapped four
first) drive the rest: three carries extra sentences so there is a window to
pause it before it finishes on its own, pausing it lets four proceed to
completion while three stays paused throughout — the mixed-state label and
the ring inside Manage downloads are read in between, tolerant of chapter
four finishing first on a fast connection exactly as `DownloadRingProbe`
already tolerates for its own two chapters (measured 2026-09-24: the Manage
ring case raced away in 2 of 4 runs, in which case only the code
(`marker()`'s manage branch, `src/app/download-rows.ts`) stands behind that
one sub-claim). Chapter five is added last, while three is still paused, and
the method ends with three paused and five mid-flight or queued for the
host-level restart; `testOrderAfterRestart` reopens the drawer, requires
three still paused and five finished without a tap, resumes three and
finishes the download. Real spend: 19 short utterances across five chapters,
a fraction of `DownloadRingProbe`'s per-run cost.
