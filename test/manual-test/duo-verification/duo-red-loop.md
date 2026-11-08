# #350 native-loop verdict repair (HOST qualification)

`duo-red-loop.sh` uses **one shared oracle**, `duo-loop-verdict.py`, for baseline,
fold checkpoints, cycle accounting and final verdicts. HOST checks qualify that
oracle and its CLI status, **not the application**. No app repair, new native
run, causal event trace or #350 completion is implied.

## HOST commands

```sh
python3 test/manual-test/duo-verification/duo_red_loop_test.py -v
bash test/manual-test/duo-verification/duo-red-loop.sh --replay \
  test/manual-test/duo-verification/fixtures/duo-loop-public-receipts.json \
  /tmp/NEW-HOST-REPLAY-OUTPUT
# Expected exit 1: HOST_REPLAY outcome=APP_RED, four valid cycles, one failed.
```

Replay enters the actual shell driver **before any native prerequisites**, then
calls the same verdict functions used by its live `phase`, `cleanup`, `cycle`
and `summary` commands. It reads retained public captured-shape JSON, never
executes the app, inputs a fold, fetches a definition, or remeasures images.
The committed fixture contains only public `Word Boundaries for Lookup` and
Free Dictionary receipts from the four captured cycles. Its freshness bounds,
input/capture confirmations, per-phase Library hashes and cleanup confirmations
are explicitly HOST reconstructions; independent per-return hashes were not
retained. They do not supply missing live qualification. Use a **new**
output directory; replay refuses an existing one. Keep native originals,
images, raw receipts and historical guard records unchanged outside Git.

The captured fourth cycle had a valid exact `hope` positive, then `ranges:[]`
and whole-frame wash 0, while query/result/count1/Library were retained. The
original loop printed `RED-outward-range-drop` but ended with literal `exit 0`;
its original guard record's exit0 remains an **oracle defect**, not a successful
app result. Replaying that evidence now exits1 without changing the record.

## Verdict and accounting contract

- **0 / PASS:** the requested 1–4 fully qualified cycles completed, no app RED,
  every control valid, and final per-cycle cleanup verified.
- **1 / APP_RED:** at least one qualified app failure. RED takes precedence over
  cleanup/control uncertainty, which remains separately recorded. One RED at
  max cycles is still exit1; two same-path REDs stop early, not successfully.
- **2 / CONTROL_INCOMPLETE:** missing, malformed, stale, future, ambiguous or
  incomplete receipts, failed input/capture/measurement, invalid baseline,
  incomplete cycle budget, or uncertain cleanup without a qualified RED.

`summary.json`, the final `loop.log` line and CLI status agree. Each cycle retains
its original `caseVerdict`, phase verdicts, `cleanupVerified` and uncertainties.
Unreadable/malformed cleanup receipts remain uncertain; they cannot erase a
qualified phase RED. Live summary enumerates every attempted `cycle-*` directory,
not just existing cycle-verdict files. Missing/damaged cycle verdicts are recovered
from the retained phase ledger and marked incomplete. A shell aggregation-command
failure is sticky, stops further cycles and cannot count as a completed budget.
Replay consumes cycles incrementally: a malformed later entry is an incomplete
attempt, never a reason to discard an independently qualified earlier RED.
`attemptedCycles` counts attempts; `validCycles` increments only after a terminal
qualified fold verdict **and** verified cleanup; `appFailedCycles` counts REDs
including those with later cleanup uncertainty. Two **total** control-failed
cycles stop the loop; a successful positive never resets that budget. A stopped
or incomplete cycle does not become valid just because its baseline passed.

Baseline requires section0, exact CFI `epubcfi(/6/2!/4/4,/1:33,/1:37)`, forward
`hope`, offsets/anchor/focus33–37, the real parsed result, exactly one successful
non-aborted/non-failed request, a nonempty saved Library hash, painted wash and
two handle clusters. Outward **and** return compare every range identity field,
task, full parsed result, full traffic receipt and saved Library hash to that
qualified baseline. Missing values never qualify by comparing equal.

The pre-existing wash thresholds are unchanged: crop ≥0.4 plus ≥2 clusters
present, <0.05 lost, between them incomplete; whole-frame ≤0.0005 lost, anything
higher without a range incomplete/contradictory (the prior ≥0.001 visible class
also stays incomplete). Measurements still use the pinned wash and ±12 channel
calibration, without mask/threshold relaxation. On return, a dropped range is
measured against the **outer** active image, not the inactive inner panel.

## Remaining live gate — admitted tester only

The existing native invocation remains in the shell header. **Do not run it
merely because HOST tests pass.** Independently requalify the owned target,
current paused public fixture, native shell/Metro/source provenance, native
window and active display, mapping/3x raster assumptions, press point, permitted
normal request/visible result, and original pinned calibration. The lane-specific
Hub PID, geometry, pose buttons, cleanup callout coordinates and prebuilt probe
directories are historical setup, not portable defaults; no new CDP framework
or native-helper change was made here.

The capture path still permits only owned screens0/1 and exactly two PNGs. The
existing `run-probe.sh` final `Artifacts:` receipt must uniquely bind this actual
invocation's `result-STAMP.xcresult` and `test-STAMP.log`. The summary, export log
and attachments directory must use that **same** STAMP and source directory;
independent latest-file searches are not used. All selected artifacts must be
absent from the pre-invocation inventory. The selected log must contain the
restricted-v2 marker and both screen0/1 receipts; the matching result summary
must contain exactly one passed test and zero failures.

The log/result/summary/export/attachment directory and **both individual PNGs**
must have timestamps inside the host capture/export wrapper interval. Exported
file timestamps may have whole-second precision: the lower bound alone is
rounded down to the start of that second (strictly less than one second of
lower-bound uncertainty); the upper bound is the recorded completion time,
with **zero future tolerance**. The accepted source paths, STAMP, per-PNG times
and explicit precision bounds are retained in `*-capture.json`. Pre-existing
future-dated artifacts cannot substitute for the actual invocation. A mismatched
receipt, stale/future candidate or old PNG in a fresh directory fails closed.
Fresh selection/state timestamps are bounded by each actual checkpoint call,
and multiple matching selection answers are rejected instead of silently
choosing one. Input success alone cannot establish the measured pose.

Cleanup independently asks `DuoAcceptanceSelection.js` for fresh empty ranges,
always attempts traffic restoration even after another cleanup failure, verifies
fresh clean task/result/gate/traffic/error/loading state, and checks harness-file
removal. Failure preserves the case verdict and leaves sticky uncertainty.

The heartbeat still invokes `cdp.cjs` repeatedly with a 300ms pause **after each
call**, opening a fresh CDP connection each time; it is not a persistent session
or proof of a 300ms connection cadence. A registration/liveness failure remains
a control failure. No session-reuse framework was added. The existing kit sender
was not changed: later live qualification must also establish fresh monotone
answers across harness-file removal; missing or reused answers fail closed.

Retain raw baseline/outward/return/cleanup receipts and the new nonzero guard
record during the next admitted native qualification. No scoped app event trace
at the captured loss moment was supplied; preserved-cycle frame replacement
observations do not establish why the fourth cycle lost its range. Native
qualification and subsequent diagnosis remain open, without an app hypothesis
asserted as fact.
