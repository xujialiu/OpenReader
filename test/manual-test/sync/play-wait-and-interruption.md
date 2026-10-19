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
