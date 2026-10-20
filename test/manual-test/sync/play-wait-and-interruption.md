# A press of Play made visible, and an interruption honoured (#304, #303)

Verifying b8325b9 (`1.0.0 (9)-beta11`) on the simulator, 2026-10-20. The app is
the worktree's own Debug build, connected to Metro on 8081. r1 ran on the
session's iPhone 17 Pro (iOS 26.5, `19A488E2-455A-42C2-A17C-BF8AA851FC78`);
r2 and r3 on the session-owned `ios-check-b11-r2` (iOS 26.5,
`A484C147-264E-4D59-906D-6C88D2C0EF5F`). Artifacts: `/tmp/ios-check-b11/`,
`/tmp/ios-check-b11-r2/`, `/tmp/ios-check-b11-r3/`.

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
device's audio stack (below). r3 later traced these aborts to the Mac's own
sleep — see the corrections below.

## The recovery, and where each measurement finally stands

The recorded recovery (shutdown + boot of `ios-check-b11-r2`, no erase,
`verify-recovery.sh`, log `recovery.log`, record `recovery.json`) did **not**
clear it: the healthy-folder control Play still aborted
(`OpenReader-2026-10-20-070226.ips`, same stack, launched 07:01:13, abort at
07:02:26). With the one recovery spent, the remaining checks were **BLOCKED**
by that environment failure, per the parent's instruction — until the owner
found the Mac's own sleep behind it and r3 reran the missing checks.

## Corrections forced by the third attempt

**#304 (d) was never established on beta11.** From 2026-10-20 00:50:40 the app
on 19A488E2 ran **another session's `1.0.0 (9)-beta12` bundle**. That device's
own Debug Log (`…/546C1954-76B2-4E39-8A12-4DEE43EC82B8/Library/Application
Support/debug-log/debug-log-000001.txt`; its `version.txt` reads
`1.0.0 (9)-beta12`) begins by clearing beta11's logs, and every `[launch]`
line from then on names beta12:

> 2026-10-20 00:50:40.648 +08:00 [launch] OpenReader 1.0.0 (9)-beta12, native 1.0.0 (9), Debug Mode on, Metro bundle, system log on, kept in file:///…/546C1954-…/debug-log/; cleared the Debug Log of 1.0.0 (9)-beta11: 2 files, 2.0 MB
> 2026-10-20 00:51:06.466 +08:00 [launch] OpenReader 1.0.0 (9)-beta12, …
> 2026-10-20 00:54:25.275 +08:00 [launch] OpenReader 1.0.0 (9)-beta12, …
> 2026-10-20 01:03:48.694 +08:00 [launch] OpenReader 1.0.0 (9)-beta12, …
> 2026-10-20 01:06:17.025 +08:00 [launch] OpenReader 1.0.0 (9)-beta12, …
> 2026-10-20 01:14:52.617 +08:00 [launch] OpenReader 1.0.0 (9)-beta12, …

So the 00:56:05.830 → 00:56:07.850 "(d) waited again" evidence measured
**beta12, not beta11, and is void**; the interference on that device began by
00:50:40, not "~01:04" as written in the r1 bullets below; and the (d) attempt
at 00:49 (`probe-d2.log`) had already failed — `Nothing had started 3 s after
the press` plus the trailing Pause tap (2 failures) — with its app log not
surviving the beta12 launch that cleared the file 88 s later. (d1)'s
fast-server run at 00:48:09 predates the first beta12 launch and stands as a
beta11 observation, but (d) needed a clean rerun; r3 provides it.

**The r2 aborts belong to the Mac's own sleep, not to a standing environment
defect.** `pmset -g log` shows `Sleep` at 05:56:23, a DarkWake at 06:12:06 and
`Sleep` again at 07:40:01, and the `_ReportRPCTimeout` ← `AURemoteIO::Cleanup`
← `mainMixerNode` aborts at the first engine start (06:14:47, 06:17:04 and the
06:52–07:02 baseline runs) all fall in that window (the 05:37:32 abort
predates it). The owner then prevented system sleep (`pmset -g`: `sleep 0
(sleep prevented by … Amphetamine)`), and r3's fresh-launch control on the
same device passed first try (below, load 3.8–4.6). The section above stands
as what was seen, with this cause attached.

## r3 — the missing checks, on a Mac kept awake (2026-10-20 09:18–09:40)

Attempt directory `/tmp/ios-check-b11-r3/`; the same session device
`ios-check-b11-r2`, the same installed beta11, Metro 8081 of this worktree,
fake Kokoro 8795. One fresh launch was made (09:18:48); every phase read the
app's `[launch]` lines around its window, and exactly one launch exists in the
whole attempt — beta11 from Metro:

> 2026-10-20 09:18:48.960 +08:00 [launch] OpenReader 1.0.0 (9)-beta11, native 1.0.0 (9), Debug Mode on, Metro bundle, system log on, kept in file:///…/A484C147-…/debug-log/

Scripts `verify-control.sh`, `verify-d.sh`, `verify-phase2{,b,c,d,e}.sh`,
`verify-phase3.sh` with their logs and guard records in the attempt directory;
the probe build reused r2's `/tmp/ios-check-b11-r2/probe-playwait`.

- **Control — PASS.** `ios_ready --metro` passed; Settings shows `1.0.0 (9)-beta11-debug`
  (`control-version.png`). With the fast stub on 8723, one ordinary Play
  sounded: `[reading] play at utterance 6` 09:19:26.431, `engine.start.done …
  state=1 running=1` 09:19:27.519, pause 09:19:30.351 (~2.8 s of sound),
  `[sync] play: ok` / `pause: ok, … uploaded`. No new `.ips` (the latest
  remains 07:02:26). The r2 abort did not reproduce.
- **#304 (d) — PASS.** (d1) fast server: `run against` 09:20:30.026 →
  `play: ok … uploaded` 09:20:30.104 → `play at` 09:20:30.105 (play ~0.9 s
  after the tap); the stub logged GET 404 + PUT at 01:20:30.088/.103 — the run
  reached the server (`webdav-8723-fast/requests.log`). (d2) GET hanging
  25 s, the next press 13 s later: **no `not waited for` line**;
  `[sync] run against` 09:21:02.793 → `[reading] play at` 09:21:04.812 =
  **2.019 s** after the run start (~2.8 s after the tap); the +482 ms shot
  (`attachments-20261020-092050-20466/9E3A9AD0-…png`) shows the spinner in the
  transport's centre button with the label Pause. The hung run failed at
  09:21:17.825, after the measurement. Both probes: `Executed 1 test, with 0
  failures`.
- **#303 phase 2, an interruption on the simulator — BLOCKED: a simulator
  coverage limit.** Four bounded attempts, each with OpenReader playing and a
  tone served from the Mac on 8796: (i) the probe's own Safari route
  (`testInterruptWithSafari`, 0 failures — it asserts its taps, not the
  interruption): no interruption; (ii) the `<audio controls>` page enlarged
  and centred: its controls are invisible to the AX tree (only scroll bars and
  the address field) and two confirmed synthetic taps (`axe touch` rc=0,
  `axe tap` "completed successfully") never produced a page click — the
  page's own status line stayed `idle`; (iii) the same page with a body
  onclick so any tap starts the audio inside the gesture: still `idle`; (iv)
  Safari's own audio viewer for the direct `tone.wav` URL: the centre tap
  **did start real playback** (`safari5-after.png`: the viewer's Pause icon,
  `00:09 / -04:50` advancing), and OpenReader still logged no
  `interruption.began` and no `pause.interrupted` — it kept playing and its
  transport still read Pause. No `ended`/`shouldResume` exists to quote:
  nothing began. Safari's playback was stopped by terminating it immediately
  after the fact. Whether an audible (volume above 0) simulator would deliver
  the interruption is not testable under the kit's silence rules; the check
  stays open for a physical device.
- **Phase 3, the plain regression — PASS.** `testPlayPausePlay`, 2 rounds, 0
  failures, load 3.2: play 09:39:04.038 → pause 09:39:07.493 and play
  09:39:11.673 → pause 09:39:15.909 — each press sounded (the utterance moved
  6 → 7) and the transport returned to Play. The Lock Screen/Now Playing Play
  during the sync wait was **not attempted**: the kit's `lock-device.sh` has
  no build on this machine (a from-scratch `xcodebuild`) and the Pitfalls
  record it failing before the tap on iOS 26.5 (beta20) — not cheaply
  drivable, and the task made it optional on exactly that condition.

Playback durations in r3, each the shortest that establishes its fact: control
~2.8 s; (d1) ~3.8 s, (d2) ~1.8 s (the wait vs no-wait is decided before the
sound matters); phase 2's staging plays ran 20–32 s each while Safari was
being driven, stopped by each script's trailing pause, plus Safari's own
inaudible tone (~1 min, stopped by terminating Safari); phase 3 ~3.5 s and
~4.2 s. Total app playback in r3 ≈ 2.5 min.

## The verdicts after r3

Verdicts, with what each fact was measured on:

- **Phase 0 — PASS.** r1: build, install, Metro, readiness, Settings showing
  `1.0.0 (9)-beta11-debug` (kept above). r2: the same app installed on the
  session-owned device, `ios_ready --metro` passed, the version confirmed
  again (`recovery-version.png` after the boot). r3: after a fresh launch the
  readiness passed and the version confirmed again (`control-version.png`),
  and the ordinary-Play control that r2 could not run sounded with no abort.

Artifacts for the r2 verdicts are under `/tmp/ios-check-b11-r2/` (probe
projects, `phase1ac.log`, `recovery.log`, `baseline-diff.log`, screenshots);
r3's are under `/tmp/ios-check-b11-r3/` (`control.log`, `phase-d.log`,
`phase2*.log`, `phase3.log`, the screenshots named above, `control-version.png`);
r1's are under `/tmp/ios-check-b11/` (`probe-playwait/`, `a1-spin-*.png`,
webdav and fake-tts logs).
- **Phase 1 (a) — PASS** (r1 evidence window, 00:39:06–00:39:53 +08 on
  19A488E2 — before that device's contamination, whose first beta12 launch
  was 00:50:40, not ~01:04 as this bullet said before r3):
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
- **Phase 1 (d) — PASS** (r3, clean rerun on `ios-check-b11-r2`; the r1
  windows are void — see the corrections): the fast server's run succeeded
  (`play: ok … uploaded`, GET+PUT on the stub, play **~0.9 s** after the tap)
  and the next press with the GET hanging waited again — no `not waited for`
  line, `[sync] run against` 09:21:02.793, `[reading] play at`
  09:21:04.812 (**2.019 s** after the run start), the spinner visible at the
  press (+482 ms shot).
- **Phase 2 — BLOCKED as a simulator coverage limit.** r2 could not run it
  (the engine-start aborts, above). r3 ran it four ways on a healthy engine
  and the iOS 26.5 simulator never delivered an interruption — even with
  Safari verifiably playing (details in the r3 section). Nothing was measured
  against #303's interruption handling; it stays open for a physical device.
- **Phase 3 — PASS** (r3). The plain Play → Pause → Play sounded on every
  press (2 rounds, 0 failures); the Lock Screen/Now Playing Play during the
  sync wait was not attempted, the kit's lock-screen driver being not cheaply
  drivable on this runtime (no build on the machine; the beta20 pitfall has
  it failing before the tap on iOS 26.5).

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
