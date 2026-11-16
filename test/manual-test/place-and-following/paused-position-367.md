# Save position while paused, #367 (1.0.5 (33)-beta2-debug) — paused-choice acceptance

Verified 2026-11-17 on the session-owned simulator `qa367-click`
(iPhone 17, iOS 26.5, UDID `0205D762-2F6B-4921-971B-CF6ECA2EF9CB`), Debug app
installed by the app-installer from the frozen authoritative tree
(`/Users/xujialiu/orca/workspaces/openreader/click`, 677c579 + the frozen
uncommitted patch), fingerprints re-checked unchanged during verification.
Metro 8367 (node 90386) served every run; every relaunch pinned
`-RCT_jsLocation localhost:8367`. Attempt `/tmp/openreader-click-367.2YD8RW`,
`recoveryCount` 1 (one target-only shutdown+boot, spent on the AXe hollow-tree
wedge below).

## The XCTest input probe

`PositionChoiceProbe.swift` (this folder) is an env-driven XCUITest single-test
driver (`POS_ACTION=button|toggle|alert|point|query|swipe|type`, with
`POS_EXPECT_SWITCH`/`POS_EXPECT_LABEL`/`POS_EXPECT_FIELD`/`POS_ASSERT_PAUSED`
assertions inside the test, so `Executed 1 test, with 0 failures` covers each
action's effect). It exists because the AXe accessibility tree on this device
went **hollow twice** (a bare Application node with no children for minutes;
one recorded shutdown+boot restored it, and it recurred after later
terminate+launch cycles) while XCTest, CDP/harness, screenshots and container
file reads stayed healthy. After that wedge, native input used this probe.
T1 used AXe touches with fresh native-tree and saved-file readback; later
sentence taps, skips, Consent answers and Sync-screen typing used XCTest. Run it through
`kit/run-probe.sh` with `TEST_RUNNER_POS_...` env keys; note that a FAILED run
makes the runner terminate the target app, so scripts must relaunch and must
not probe for state they only expect sometimes.

## Scenario (per attempt; every phase ran under the shared guard)

- **T1 settings control** (`phase-t1-settings.log`): General shows
  `Reading position` → `Save position while paused` (CheckBox value 0) → the
  exact footer → `Reading aloud`, in that y-order; a real touch flips the
  switch, `Documents/settings.json` gains `savePositionWhilePaused: true`, the
  value survives a terminate+relaunch, and toggling back restores `false`. The
  Settings root screenshot `tester/t1-settings-version-clean.png` shows
  **Version 1.0.5 (33)-beta2-debug** unobscured (the installer's own version
  screenshot had been covered by a Library actions drawer).
- **T2 no-provider save + OFF baseline** (`phase-t2b/t2c`): with the setting ON
  and **no Provider/key** (`enabledProviders: []`, `voice: ""`), one genuine
  XCUITest tap in a never-played real EPUB saved its selected sentence,
  moved both stamps, promoted it to the shelf top, with the
  fake-TTS journal at zero requests. With the setting OFF, Shadow Slave's first
  speech (real Play touch, Consent alert answered through the probe's native
  alert query after checking the recipient `127.0.0.1:8897`) saved S1; a
  genuine tap elsewhere moved the cursor (8→6) while `library.json` stayed
  byte-identical; leave/reopen and terminate/relaunch both restored S1 paused.
- **T3 transitions** (`phase-t3/t3c/t3d/t3e`): enabling ON with an unsaved
  cursor saved nothing (file byte-identical, entry stamp unmoved); the next
  explicit tap on a different sentence saved it; re-tapping the saved sentence
  (aimed at the painted highlight band, `tester/hl-band.py`) and a moving skip
  landing on it re-stamped nothing; disabling retained the saved choice; seek-0
  while OFF parked an unsaved cursor that enabling did not save; a boundary
  Previous-sentence skip at utterance 0 produced the handler line and saved
  nothing; disable + unsaved tap + leave/reopen kept the saved sentence.
- **T4 four skips + relative promotion** (`phase-t4/t4b/t4c/t4d`): all four
  real Transport skips moved and saved (entry stamps advancing, zero synthesis,
  `POS_ASSERT_PAUSED` in every run); a tap in Cultivation Online promoted it
  above Shadow Slave, and one moving skip promoted Shadow Slave back above CO —
  shelf order proven relative in both directions.
- **T5 exclusions, speech sanity, sync contract** (`phase-t5c attempt7+`,
  `phase-t5d`): an in-reader page scroll, a browse that moved the page
  (`rendered=3/256 → 5/256`), a theme repaint, and a long-press lookup-open
  (the drawer's own pause) all left `library.json` unchanged; speech resumed
  FROM the saved paused choice (`play at utterance 59`) and its pause saved the
  reached sentence. Sync against the controlled DAV (`cacheable-dav.cjs 8797`):
  the transport PUTs the Positions File on an ordinary cadence (observed gaps
  12.0–79.8 s, often with unchanged bytes), a paused choice produced **no** PUT
  within 6 s (the minimum cadence gap is 12 s, so a choice-poked moment is
  distinguishable), and the stop/leave moment carried the choice's sentence
  (PUT #12). No settings file is ever PUT and the uploaded positions contain no
  `savePositionWhilePaused`.

## What it cannot prove

- The exact newer/older/kept remote-arrival races and the writeback timing
  windows are host-tested (`test/app/general-position-setting.test.ts`,
  `reading-stop-writes-and-syncs.test.ts`); on device I verified only the
  observable contract (no per-choice PUT, ordinary moments carry the choice).
- The long-press opened the lookup drawer but no lookup was completed (no
  external dictionary call), so "selection with a completed lookup does not
  save" is not separately verified by this device run.
- iPad/Mac were not run: only this iPhone simulator had the authorized
  install. The changed logic is shared JS state; the native row renders from
  the same component on all targets.

## Recording

Attempt dir `/tmp/openreader-click-367.2YD8RW`: `phase-t*.json` exit records,
`phase-t*.log` transcripts, `tester/` raw trees/screenshots/probe logs and the
failed-attempt subfolders (each failure is kept with its cause). The probe and
this recipe are committed on the verification branch for the parent to
integrate before further claims rely on them.
