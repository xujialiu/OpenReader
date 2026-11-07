# Duo diagnostic controls: crash attribution and silence resets (#357/#358)

**Preparation, not native acceptance.** No simulator, build, AX, LLDB, playback,
install, reboot, host-volume or output-route operation was run for this change.
Neither issue is supported for closure. Only host evidence-handling tests ran.
The app, native target/probe projects and `app-version.ts` are unchanged.

## Evidence preserved for #357

Original: `/tmp/openreader-issue346-native-01/logs/OpenReader-2026-11-07-090059.ips`.
SHA256: `3830357ff7d0a16d2d32589f5f0953d98d2056ca24541e7b7825357fc51064f5`.
The original was read, not modified. A byte-identical copy and 55 associated
files are under `/tmp/openreader-350-358/diagnostics-original/`;
`manifest.json` records source/copy paths, SHA256, size and source mtime in
nanoseconds. Personal paths, raw logs and Document content stay out of git.
Keep both original and copies; the copied historical scripts are **not** safe
instructions to execute again.

| Clock/source | What is actually established |
| --- | --- |
| `.ips` `procLaunch` 2026-11-07 08:51:18.3360 +0800 | Process 35421 launched on the named Duo. |
| `logs/launch-b13.txt` 08:51:22.267 +08:00 | App reports `1.0.4 (30)-beta13`, native `1.0.4 (30)`, Debug Mode on, Metro bundle. The incident is not itself a beta14 run. |
| `phase-rotA.sh`, `guard-rotA.json` | Script requests public single-mask landscape geometry through LLDB, reads AX, changes Font Size, reads AX again, then requests portrait geometry and reads page/position state. Guard records exit 0 / 43.633 s, without wall-clock start/end or individual action outcomes. |
| `phase-rotB.sh`, `guard-rotB.json` | Script clicks the open pose, serially requests/reads portrait and landscape geometry, captures display 1, and clicks closed. Guard records exit 0 / 71.568 s, without individual action timing. |
| `logs/screen-rotB-inner-portrait.png` source mtime 09:00:24.111097 | A nearby file-write time, not proof of the complete preceding native action sequence or debugger detachment. |
| `.ips` `captureTime` 09:00:52.2895 +0800 | Process 35421 traps with `EXC_BREAKPOINT` / `SIGTRAP`, termination signal 5; thread 0 is triggered. |
| `.ips` header timestamp 09:00:59 +0800 | Report timestamp, distinct from capture time. The preserved source file mtime is later still (09:02:28.238488). |
| `phase-clean-rot.sh`, `logs/probe-duoroot.log` | Later control reports one test / zero failures in 7.945 s. It is a separate execution, not attribution of the earlier trap. |
| `phase-stability.sh`, `guard-stability.json` | Later three-cycle pose/AX control script and exit-0 wrapper exist. They do not prove the earlier concurrent inspection sequence safe or fixed. |

The triggered stack is `_os_unfair_lock_recursive_abort` →
`_os_unfair_lock_lock_slow` → `method_t::imp(bool) const` → Foundation KVC →
AXCoreUtilities `safeBoolForKey:` →
`UIApplication(UIAccessibility) _accessibilityIsAppReadyToBeProbed` → AXRuntime
callback/run loop. That establishes an accessibility callback was executing.
It does **not** identify who acquired the lock, establish an LLDB overlap,
assign ownership to application code, or exclude a platform fault. The JavaScript
thread is waiting in Objective-C method/protocol introspection; that is another
stack observation, not a causal conclusion.

Both historical rotation scripts suppress debugger output/errors, omit `set -e`
and finish with `exit 0`. A guard's `passed` is therefore not a checked native
result. The issue reports overlapping timed-out AX/LLDB work, but a complete
wall/monotonic-timestamped attach/expression/timeout/detach and AX begin/end
transcript is **missing from the retained nearby files**. Do not replace that
missing trace with file mtimes or assert the script text was delivered exactly.

### Diagnosis stop rule

Parsing this report cannot drive the crashing code path. There is no safe,
already-run red-capable crash loop in this preparation. Phase 1 is incomplete;
reproduction/minimization, ranked causal hypotheses, hypothesis-specific probes,
app fixes and native red/green claims are consequently not applicable yet.
No crash hypotheses were generated or tested. The new observer's malformed-file
host test is a harness test, not a crash reproduction.

### Bounded runtime handoff for #357 (tester only)

Use the parent's single admitted lane and **existing attempt/recovery ledger**.
The original attempt's recovery allowance is exhausted; do not reboot, erase,
reinstall or use a fresh directory to reset it. Parent acceptance must name the
current source/native shell, explicit owned UDID, Metro target and paused fixture.
Read [the shared gate](../kit/ios-verification.md) before admission.

1. Complete device/app readiness on a non-secret screen. Record wall time with
   UTC offset and monotonic time, current app PID, current Debug Log launch line,
   active display, existing crash-report paths/hashes and `playing=false` before
   any input. A PID missing or ambiguous at this baseline is BLOCKED, not a crash.
2. **Clean control first:** no native debugger and no AX operation in flight.
   Through the visible Device Hub, deliver exactly one closed → partial → open →
   closed cycle, with current-window calibrated controls (not the historical
   hardcoded coordinates). Allow at most 3 s to settle per pose; record dispatch
   start/end and a post-input target/display observation. Confirm the same PID
   after each delivered input. Do at most three cycles (36 s of pose settling,
   plus bounded tool time). This bounds a stability control; it does not clear
   the old incident if no crash is observed.
3. **Further diagnostic probes remain gated.** If the clean input cannot produce
   the original crash, stop and request the missing original action trace or a
   separately approved safe reproduction environment; do not launch intrusive
   inspection to fish for a cause. Only after a real red loop, minimization and
   ranked falsifiable hypotheses have reached the parent may an AX-only control
   be mapped to a specific prediction: one 20 s-bounded tree read, wait for its
   process to exit, then verify the PID. Do not attach LLDB to rescue a timed-out
   AX read. Stop after that failure and retain the raw output.
4. Under that **same hypothesis gate**, a separate LLDB-only control, if needed
   for a stated prediction and approved, uses `kit/owned-lldb.sh` with an explicit
   UDID, read-only task-scoped expressions and explicit `process detach` / `quit`.
   Keep all expression output and process start/end times. Confirm detachment and
   LLDB exit before any AX, screenshot or Device Hub input. An interrupted
   expression or uncertain detach is BLOCKED; no second attachment and no
   overlapping inspection is permitted.
5. On process exit, stop all input; preserve the new `.ips`, complete preceding
   action ledger, launch/PID evidence and local relevant logs before any restart.
   Compare the *new* exception and triggered stack with the retained original.
   Missing PID alone is not the original `_os_unfair_lock_recursive_abort`
   symptom. Do not count a read-only expression interruption as an app crash
   without process-exit/report evidence.

The missing next experiment is a safely delivered, repeatable serial input that
actually traps with the same signature, or a complete contemporaneous original
trace sufficient to discriminate the attribution. If neither is available,
return BLOCKED with that exact gap. After a real red loop, minimize one action
at a time, then send 3–5 ranked falsifiable hypotheses to the parent **before**
testing any causal probe. Do not deliberately restore the unsafe overlap.

## What silence.sh actually measures (#358 / #21)

`kit/silence.sh set` writes `sim_volume=0` into one booted device's own
`data/var/run/simulatoraudio/audiosettings.plist` and extracts that key again.
`check` extracts it and fails unless the raw value is `0`. It neither queries
CoreAudio nor reads the running app's `AVAudioSession.outputVolume`, session
activation time or rendered output. It has no continuing watcher. It cannot
prove that a previously activated session adopted a subsequent plist write.

#21's historical iOS 27.0 tone/process-tap control measured 286,720 samples over
3 s: plist 60 / session 0.6 / peak 0.09 versus plist 0 / session 0.0 / peak 0.
The same investigation found that changing the file under already-playing audio
did not attenuate that active stream. Those are historical measurements, not a
current iOS 27.1 or SDK58 validation. Boot → set → launch and a fresh check
immediately before any Play remain necessary, **not sufficient proof of
continuing silence**. Never bypass a nonzero/missing/invalid/read-failed gate.
If a reset has occurred, setting the file while leaving the old session active
is not an established repair; stop, preserve evidence and stage a fresh session
only under the tester's approved procedure.

Retained `logs/probe-open-p.log`, `probe-open-lr.log`,
`probe-closed-landscape.log`, `probe-closed-portrait.log`, `probe-open-ll.log`
and `probe-caret.log` contain volume-60 refusals. Their messages alone do not
record the immediately prior zero, exact reset time, active audio state or
cause. Later parent/ordinary-device resets are also reported in #358 and the
engineering record, but no synchronized device/CoreAudio reset trace was found.
Existing pitfalls mention output-device events near rewrites. Correlation is
not host-route causality and is not permission to manipulate the host route.

### Read-only observer and host checks

No reusable timestamped raw observer was found in `test/` or `scripts/`.
`kit/silence-observe.py` adds only that missing evidence collection:

```sh
# Host-only; no simulator contacted, no shared lock acquired.
PYTHONDONTWRITEBYTECODE=1 python3 test/scripts/silence_test.py -v
npm test -- test/scripts/silence.test.ts

# TESTER ONLY, inside the admitted foreground phase:
python3 test/manual-test/kit/silence-observe.py "$DEVICE" "$OUT/idle" \
  --seconds 300 --interval 1 --label idle
# One timestamped checkpoint instead of a window:
python3 test/manual-test/kit/silence-observe.py "$DEVICE" "$OUT/before-relaunch" \
  --seconds 0 --label before-relaunch
```

The output directory must be new. It contains `result.json`, `samples.jsonl`,
raw `sample-NNNN.plist` files with SHA256, stable file identity/mtime/size,
wall/monotonic read times, volume and the **plist's** output-device UID, plus
raw/parsed start/end boot-listing checkpoints and subprocess exit records.
Listing checkpoints do not prove no intervening boot. The observer stops at
its first nonzero, invalid/missing/racing read or failed/timed-out command;
it never re-silences, retries recovery or authorizes/starts playback.

- Exit **0**: only zero in sampled plists during this bounded window.
- Exit **3**: nonzero observed; `zeroToNonzeroObserved` is true only if a
  preceding valid sample was zero. An initial 60 is not a newly observed reset.
- Exit **69**: BLOCKED / incomplete evidence, including a failed end checkpoint.
- Exit **2**: usage, existing destination or invalid bounds; **130/143**:
  cancelled, with partial evidence retained.

Cadence is 0.25–10 s; duration is 0–600 s. The default per-command timeout is
3 s (maximum 10). The enclosing guard must also bound the whole phase. Sampling
can miss a brief transition and cannot date a rewrite more precisely than the
last-zero/first-nonzero interval. Raw bytes are limited to 64 KiB per sample;
oversized input retains a prefix and is BLOCKED, never accepted as a full plist.

Host tests exercise the **real** `silence.sh` entry with fake Apple tools and an
isolated HOME: accepted zero; rejected nonzero, missing file/key, malformed
plist, invalid value and tool failures; `check && action` never executes the
action on refusal; `set` leaves the route/ringer/other device unchanged. Observer
controls cover raw hashes/times, a synthetic 0→60 transition, invalid XML/types,
file replacement during read, subprocess deadline, end-checkpoint failure,
cancellation and evidence-collision refusal. These are not native audio tests.

### Bounded no-playback reset-observation scenario (tester only)

Preparation ends here; the following controls have **not** been run. The parent
must provide the admitted lane, ownership/readiness and unchanged recovery ledger.

1. Record the current paused app's provenance/PID and a timestamped boot/plist
   checkpoint. Do not start a Reading, Pronunciation, tone or other audio.
   Retain existing state; do not reboot to manufacture a control.
2. Inside that same admitted foreground phase, run `silence.sh set DEVICE` and
   `check DEVICE`, each under a 10 s child-command deadline with stdout/stderr
   and exit status retained. Chain with `&&`; a failure stops the phase.
   Then run the observer above for **300 s at 1 Hz**, with no other native
   inspection/input in flight. The window covers the previously reported
   35–90 s and up-to-five-minute quiet resets; no reset in 300 s is only a bounded
   negative observation, not proof the fault is gone. There is no audio to hear.
3. Stop at the first nonzero/invalid sample. Do not silently set again. Retain
   the last-zero/first-nonzero raw bytes, command records and start/end state.
   Verify whether a boot/app exit or any deliberate input occurred in that
   bracket; absence of an action in this script alone does not exclude external
   platform events. A second run needs a separately labelled checkpoint, not an
   overwritten folder or repeated readings of the same 60 counted as resets.
4. If the idle control is complete and the parent still needs the recorded
   relaunch/staging input, do **one** explicitly recorded target-only terminate,
   set/check, launch of the same app, with no harness command left to replay and
   no playback. Save each command's wall/monotonic interval, status, before/after
   PID and fresh launch line. Capture `--seconds 0` checkpoints immediately
   before/after, then a separately labelled 300 s observation. Do not change
   Provider, Voice, route, host volume, another device or any shared lock file.
   No failure is answered by a reboot or repeated relaunch loop. This is a
   bounded attempt to capture a repeatable symptom, not a causal relaunch A/B.
5. Total budget: two five-minute windows plus bounded staging/listings, at most
   **720 s** in one `ios_guard.py run` phase. Keep all children foreground or
   explicitly wait/clean their recorded process trees before releasing admission.
   The observer itself needs no persistent process/server and acquires no lock.

A native 0→nonzero capture is the missing reset symptom evidence; one capture
alone is not yet a tight deterministic loop. Once it can be repeated/minimized,
send ranked falsifiable hypotheses before adding probes.
The subsequent *measurement* gap is synchronized current-runtime guest session
volume/activation state and actual per-process output around that bracket;
plist UID/mtime changes alone cannot supply it. This patch adds no native
instrumentation. Coordinate any such target/probe change with the parent.
Do not repeat the old nonzero tone control through the owner's speakers, change
host volume/routes, or treat silent fixture PCM as proof that volume attenuation
works. Playback acceptance requires a separately approved, safely guarded native
control, not this observer's exit 0. Return #358 unresolved if that control or a
real reset loop is unavailable.
