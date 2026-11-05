# The Download-consistency batch on the simulator (#253, #171, #277, #172, #278)

Real-touch verification of the Download recovery/completion-consistency batch on
a session-owned simulator, against the kit's fake Kokoro. The dated
measurements, the per-run result table and the corrections discovered during
the runs live in [notes/NOTES_2026-11-06.md](../../notes/NOTES_2026-11-06.md);
this recipe holds what a rerun needs.

## Preconditions

- Frozen app tree at a batch commit; Debug app built with
  `EXPO_PUBLIC_OPENREADER_VARIANT=debug EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1`
  (prebuild **without** `--no-install`, then `xcodebuild … RCT_METRO_PORT=PORT`),
  installed on a session-owned iOS 26.5 device, launched once (the launch line
  names the version: `1.0.4 (30)-beta4-debug` for the verified batch).
- Delivery Metro started from the parent checkout on a fresh port; the app's
  `RCT_METRO_PORT` baked by the build.
- `downloads/fake-kokoro-two-voices.cjs PORT` (1 s clips; the verification used
  `OPENREADER_FAKE_TTS_DELAY_MS=1200`; #171 restarts it with 25000 — see
  Timing). Its log is the request evidence: one `text=` line per synthesis.
- `fixtures/download-consistency-fixture.ts` books staged into the app with the
  harness (`add` from the Library — a reader-mounted poller does not consume
  it), then a `noop`; Provider `local` Kokoro pointed at the fake, voice
  `af_bella`, and the Consent alert read and answered once (it names the fake's
  address). The books regenerate with fresh content hashes, so a book whose
  download state was consumed by an attempt cannot be reused — generate a new
  one instead.
- The wrapper `downloads/run-download-consistency.sh UDID OUTPUT METHOD
  PARAMS.json`: holds the shared guard, generates the probe project,
  **clears all `DC*` parameters**, writes `DCPROBE_VERSION=dc4` and a unique
  `DCVERIFY_TOKEN`, uninstalls and reinstalls only the actual runner host
  (`top.xujialiu.openreader.manualtests.xctrunner` — the test bundle's
  identifier without `.xctrunner` is a different, wrong target), sets the
  simulator's volume, runs one method, and then requires the executed log to
  carry `DC-CODE-V4`, the matching token, and the exact requested parameters.
  `PARAMS.json` uses uppercase names and string values. A failed test exits
  nonzero **before** the provenance check — read the executed marker and token
  lines in the log yourself for a failing run.

## Scenario book-keeping that the runs turned out to need

- **A failed probe run terminates the app** (run-probe's cleanup, rc ≥ 65).
  Any in-heap state — an injected method wrapper, a staged selection — dies
  with it. Stage in one method, verify, act in the next, and never assume
  in-heap state survived a red run.
- **The runtime's clip memory cache outlives Delete all audio** (#311): a
  re-download right after a delete re-saves every clip with zero provider
  requests. Terminate and relaunch the app between a delete and any download
  whose request count is evidence.
- **Fixture sentences are unique across books by design** so a download cannot
  be answered by another book's saved clips; do not reuse sentence text when
  adding books.

## Scenarios, parameters, assertions, limits

### Working control (before any fault)

`testSelectAllAndStart` + `testWatchSettled` on a fresh two-part book. The
Consent alert is this method's other success (`CONSENT-UP` in the log; the
shell reads it with `ax.py alert`, checks the recipient, answers Allow).
Asserts the count line, the check markers, and — via the fake's log — real
requests arriving.

### #172 — empty parts and the continued-processing count

`testSelectAllAndStart` + `testWatchSettled` with `NOCHECK` naming the empty
parts: an inspected empty part leaves the Download list entirely and never
carries a check. The Debug Log's `[download] continued task submitted
showing …` lines are the native-bound values. **Limits**: the simulator
refuses the continued-processing task (every submit line ends `: not run`), so
no Live Activity renders; the finished-state numbers (`1 of 1`, `0 of 0`,
completed 1000 of total 1000) are read by evaluating `continuedShown` in the
app's own Hermes over the real repository batch (CDP `--eval`, module
`src/offline/continued-processing.ts`, repository from
`src/offline/database.ts`), not from a rendered Live Activity or a native
end-update.

### #278 — the completed line after a bracket-setting change

Download the `Bracket Sentence Fixture` (its `<Seven eta>` is XML-escaped so
the chapter really contains the brackets), verify `1 chapter downloaded` with
no state line, then toggle Settings › General's `Remove enclosing brackets
when reading` by real touch and re-open the drawer: with a membership key the
saved clips do not cover, the drawer reads `0 chapters downloaded` with **no**
`Selected chapters downloaded` line and no Resume all; after a relaunch it
persists; toggling back restores `1 chapter downloaded`. No toggle or relaunch
may add a single `text=` line. The explicit re-download
(`testRedownloadChapter`) fetches exactly the missing sentence.
**Catalog evidence**: compare `memberships.clip_key` with `clips.key` for the
document (the rekeyed sentence's keys diverge until re-covered).

### #277 — Delete selected on a partly saved paused chapter

1. `testStartAndPauseRow` (`BOOK`, `ROW` = the five-sentence chapter): starts
   that chapter alone and taps its ring the moment it appears — the task
   persists paused with the chapter part-saved.
2. `testRedownloadChapter` (`ROW` = a completeable chapter): adds it to the
   paused task by real touches; the paused chapter stays paused.
3. `testWatchPausedControl` (`PART`, `DONE`): Resume all offered, `DONE`
   checked, `PART` listed without a check.
4. `testManageDeleteSelected` (`PART`, `COUNT` = the remaining completed
   count): Manage shows the part-saved chapter as a selectable row (React
   Native exposes the row itself as the checkbox — read `value`, not an
   `accessibilityRole` query); Delete selected + alert; the deleted chapter
   **leaves Manage but stays in plain Download without a check**; `COUNT`
   appears, no Resume all.
5. Relaunch and re-assert; the fake's request count must be unchanged by the
   delete and the relaunch.

### #171 — pause during held final replies, self-finish

Restart the fake with `OPENREADER_FAKE_TTS_DELAY_MS=25000` (verify ownership
by the process command line before killing), and stage `sentencesAtOnce` for
the provider high enough that every text of the book goes out in the first
waves (`{"do":"settings","patch":{"sentencesAtOnce":{…,"local":10}}}` — the
patch replaces the whole record; give every provider's value). Then
`test171PauseAllDuringFinalReplies` (`BOOK`, `COUNT`, `CHECK`,
`PAUSE_AFTER_S`): starts the whole book, waits `PAUSE_AFTER_S` seconds from
Pause all becoming visible, taps Pause all, asserts Resume all while the last
replies are still held, and then asserts `COUNT`, no Resume all, and every
check — **without any resume tap**: the held replies return and the download
finishes itself. **Timing**: the Sentences-at-once limit is global across the
download; with C concurrent and a hold D, a wave's answers land at k·D and
free the next wave — the pause must land after the last wave is *sent*
(≥ ⌈N/C⌉·D − D) and before it *returns*. Verify from the fake's timestamps:
every request line before the tap, the held answers after it. Restore the
settings record and the fake's delay afterwards. The control half — a pause
that leaves texts unsent must stay paused, and Resume fetches only the
missing texts — is `testWatchPausedControl` + `testTapResumeAll`.

### #253 — a store-read failure blocks with a reason; Resume recovers

Fault injection **in the running Hermes over the real Expo SQLite repository**
— not evidence of native disk-error incidence; the exact injected read at the
scheduler boundary is host-covered.

1. `testStageSelection` (`BOOK`): drawer open, Select all, **Download selected
   staged but not tapped**.
2. CDP `--eval`: wrap the repository instance's `progress`
   (`src/offline/database.ts` → `offlineRepository()` singleton) to throw
   `Injected progress read failure` for the target document only; keep the
   original on a global for restoration. Install it **after the last app
   relaunch** — the wrapper lives in the app's JS heap and dies with the
   process (a failed run's cleanup terminates the app).
3. `testStartDownloadAssertBlocked`: the real-touch start reaches `Needs
   attention` (the status line's label combines the words and the error —
   match by prefix), no running ring; the task persists `blocked` with the
   reason and `writing: []`; the fake's request count is unchanged (zero
   synthesis).
4. Restore the exact original method over CDP (or, if a run died, note that
   the relaunch superseded restoration and verify the fresh instance instead:
   `progress` answers normally and the global is gone). Relaunch. Re-open the
   drawer (`testAssertTaskLine` with `LINE`/`ERROR`/`RESUME`): still blocked,
   still no request — a relaunch/reopen must not auto-spend a blocked task.
5. `testTapResumeAll` (`THEN=done`, `COUNT`): the explicit Resume completes;
   the fake gains exactly the chapter's texts.

A missing required parameter is a negative control: the run must fail in
`setUp` **before any touch** (the executed log shows the assertion and zero
`Tap` lines).

## What this recipe cannot show

- A Live Activity (the simulator refuses the continued task; all continued
  values are the Debug Log's submit values plus Hermes evaluation).
- Native SQLite/disk I/O error incidence (the injection is in the running
  runtime over the real database; the boundary fault paths are host-covered).
- Audio behavior of downloads (the fake serves silent clips; silence rules
  apply anyway).
