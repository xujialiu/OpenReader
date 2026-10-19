# A press of Play made visible, and an interruption honoured (#304, #303)

Verifying b8325b9 (`1.0.0 (9)-beta11`) on the simulator, 2026-10-20. The app is
the worktree's own Debug build, connected to Metro on 8081, on the session's
iPhone 17 Pro (iOS 26.5, `19A488E2-455A-42C2-A17C-BF8AA851FC78`). Artifacts:
`/tmp/ios-check-b11/`.

## Phase 0 — admission, readiness, build (r1, kept)

- `ios_guard.py run` admitted the phase (record `phase0.json`); the guarded
  script (`/tmp/ios-check-b11/verify-phase0.sh`, log `phase0.log`) silenced the
  simulator, ran `npx expo prebuild --platform ios` (the worktree has no
  committed `ios/`), built Debug with `xcodebuild` (rc=0), installed over the
  existing app and launched. Build 206 s wall.

## r2 — the second attempt on a session-owned device

After a parallel session contaminated the shared 19A488E2 mid-run (Pitfalls),
the owner authorised a second attempt on a session-created iPhone 17 Pro
(`ios-check-b11-r2`, iOS 26.5, `A484C147-264E-4D59-906D-6C88D2C0EF5F`),
created, booted, silenced, installed and admitted in one guarded phase
(`/tmp/ios-check-b11-r2/verify-phase0.sh`, log `phase0.log`, record
`phase0.json`). Staging there: the book added through the harness, provider
`local` + `af_bella`, the Sync switch turned on against the hanging stub by
`SyncSetupProbe` (its own final `Back` tap is stale — the button is now
identified `BackButton`, labelled `Settings` — everything before it passed:
fields asserted, password typed, switch on, check passed), Consent asked on
the first synthesis and answered Allow by a real touch at 01:56:20 (`ax.py
alert-touch`; the alert named `127.0.0.1:8795`, the kit's fake Kokoro), and
the working control played (synthesis served, utterances advanced 0→3, pause
at 01:56:44).

## A first engine start on `ios-check-b11-r2` now aborts — pre-existing, not #303/#304

On the r2 device every fresh app launch followed by an immediate Play began
aborting at the first engine start: `AudioScheduledSourceNode::start` →
`materializeSourceNodeWithId` → `-[AVAudioEngine mainMixerNode]` →
`AURemoteIO::Cleanup` → `_ReportRPCTimeout` → SIGABRT, about 35 s after the
launch. Play had sounded on this same device at 01:56.

- **beta11 (b8325b9), 3 aborts across 5 fresh-launch presses**:
  `OpenReader-2026-10-20-053732.ips`, `-061449.ips`, `-061706.ips` (the
  1-minute load was 5–20 when they landed, so load alone does not explain
  them).
- **beta10 (main 2747c59, no #303/#304), served to the same installed app
  from Metro 8082 (Settings showed `1.0.0 (9)-beta10-debug`), 4–5 aborts
  across 6 identical relaunch-and-Play sequences at load 3–6, each ~35 s
  after its launch**: `OpenReader-2026-10-20-065218.ips`, `-065320.ips`,
  `-065422.ips`, `-065524.ips` (the sixth sequence failed without a new
  `.ips`). The differential script is `/tmp/ios-check-b11-r2/baseline-diff.sh`,
  its log `baseline-diff.log`, record `baseline-diff.json`.

The abort therefore **reproduces without #303/#304** and is recorded as a
separate, pre-existing finding against the simulator environment, not
against these changes. One recovery remained: shutdown and boot of the
device's audio stack (below).

## The recovery, and where each measurement finally stands

The recorded recovery (shutdown + boot of `ios-check-b11-r2`, no erase,
`verify-recovery.sh`, log `recovery.log`, record `recovery.json`) did **not**
clear it: the healthy-folder control Play still aborted
(`OpenReader-2026-10-20-070226.ips`, same stack, launched 07:01:13, abort at
07:02:26). With the one recovery spent, the remaining checks are **BLOCKED**
by this environment failure, per the parent's instruction.

Verdicts, with what each fact was measured on:

- **Phase 0 — PASS.** r1: build, install, Metro, readiness, Settings showing
  `1.0.0 (9)-beta11-debug` (kept above). r2: the same app installed on the
  session-owned device, `ios_ready --metro` passed, the version confirmed
  again (`recovery-version.png` after the boot).

Artifacts for the r2 verdicts are under `/tmp/ios-check-b11-r2/` (probe
projects, `phase1ac.log`, `recovery.log`, `baseline-diff.log`, screenshots);
r1's are under `/tmp/ios-check-b11/` (`probe-playwait/`, `a1-spin-*.png`,
webdav and fake-tts logs).
- **Phase 1 (a) — PASS** (r1 evidence window, 00:39:06–00:39:53 +08 on
  19A488E2, before the parallel session's first interference at ~01:04):
  press-shot at **+555 ms** showing the spinner and Pause
  (`attachments-.../0F298FFF-...png`), `[sync] run against` at 00:39:49.718,
  `[reading] play at utterance 12` at 00:39:51.736 (**2.7 s** after the tap —
  the 2 s wait plus press delivery), engine start 00:39:52.077, clip position
  1.841 by the pause (sound played); playback ~2.1 s, stopped by the probe.
  The r2 redo is BLOCKED by the abort (and one not-hittable tap during the
  reader's entrance, since fixed in the probe with a hittability wait).
- **Phase 1 (b) — PASS** twice. r2: press shot +633 ms (Pause), Pause at
  **+1773 ms** inside the wait, transport back on Play at +1421 ms, ten
  samples +3.6 s to +7.7 s all Play, no `play at`, 0 failures
  (`test-20261020-055504-78162.log`; the app log: `pause at utterance 3`
  06:12:09.801, the press's run failing at 06:12:23.216 — the run still goes
  on in the background). Playback: none — that is the fact being measured.
  r1: the same shape at 00:46:11–00:46:14 (`test-20261020-004603`).
- **Phase 1 (c) — PASS** twice. r2: `[sync] play: not waited for, the last
  run could not reach the server 34 s ago` at 06:41:33.046 and
  `[reading] play at utterance 8` at 06:41:33.073 — **27 ms** later, ~0.8 s
  after the tap, against **2.7 s** in (a); the +474 ms shot shows the playing
  Pause **without** the spinner
  (`attachments-20261020-004342-6561/DBAA7740-...png`). r1: the same shape at
  00:43:51–00:43:52 (`test-20261020-004342-6561`, `not waited for … 6 s ago`,
  play at +0.8 s).
- **Phase 1 (d) — PASS** (r1 evidence window, 00:48 and 00:56, both before
  01:04): the fast server's run succeeded (`play: ok … uploaded` at
  00:48:09.689, GET+PUT on the stub, play at **0.7 s** after the tap) and the
  next press with the GET hanging waited again — no `not waited for` line,
  `[sync] run against` 00:56:05.830, `[reading] play at utterance 15`
  00:56:07.850 (**2.0 s** after the run start). The r2 redo is BLOCKED by the
  abort.
- **Phase 2 — BLOCKED.** The Safari interruption needs a Reading playing;
  every first engine start aborts (above). Nothing was measured.
- **Phase 3 — BLOCKED.** The plain Play/Pause/Play is the control that
  aborts; the Lock Screen Play was not attempted.

Playback durations, each the shortest that establishes its fact: (a) ~2 s of
sound (start shown, then stopped); (b) none (a taken-back press starts
nothing — the absence is the fact); (c) ~5 s (start at once, one sentence
advance, stopped); (d1) ~3.8 s, (d2) ~2.3 s (wait vs no-wait is decided
before the sound matters).
- `ios_ready.py --metro` passed. The first run inside the phase script answered
  `BLOCKED: CDP failed` because it ran the instant `simctl launch` returned,
  before the app had bundled from Metro (`iOS Bundled 936ms index.ts (1614
  modules)` came seconds later); the immediate recheck passed with no recovery.
  See Pitfalls.
- Settings shows `Version 1.0.0 (9)-beta11-debug`
  (`phase0-version.png`, AX tree `StaticText | Version 1.0.0 (9)-beta11-debug`),
  and Metro serves the same string in `index.bundle`.
- Provider and voice: the kit's fake Kokoro (`fake-kokoro.cjs` on
  `127.0.0.1:8795`, log `/tmp/ios-check-b11/fake-tts.log`) with the app's
  carried-over settings — Provider `local`, voice `af_bella`,
  consent already kept for `provider:local@http://127.0.0.1:8795`.
- Consent preflight: after a real touch on Play there was **no alert**
  (`ax.py alert` → `NO ALERT`, exit 1); the kept consent above is the answer a
  previous session gave to the same recipient. The recipient was verified from
  the fake's own log: synthesis requests (`route=kokoro auth=absent`, no
  credentials) and nothing sent anywhere else.
- Working control: Play → `playing=true` (`reading.cjs state`), eight
  synthesis requests fetched in order, utterances advanced to the document's
  end, and the Reading stopped there by itself
  (`"That was the last of this document. The reading has stopped at the end of
  the book."`). The simulator's own volume was 0 for all of it.
