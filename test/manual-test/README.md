# Device and manual tests

Everything here runs by hand against a simulator or a phone, outside Vitest.
Before writing a script, find the feature's area below, read its README, and
read the recipe for what you are testing: how that feature was tested, with
every script, Swift probe and analyser it uses beside it. Reuse or extend one
before writing another. Save a useful new reproduction, inspection or
verification script in its area as soon as it works, and write its invocation,
prerequisites, expected result and what it cannot prove into the recipe it
belongs to. One-off probes may stay temporary; a working tool needed for the
next run belongs here.

Keep generated Xcode projects, builds, logs and screenshots outside the
repository. Accept device IDs and artifact destinations as arguments. Load only
needed credentials from `~/.secrets/openreader/`; never print or commit their values.
Follow the simulator installation guide, MEMORY/device-testing.md's silence and playback-duration
requirements, and MEMORY/app-change.md's final-running-app requirement. Choose playback duration for the fact being
measured, and stop immediately afterwards, including after failures.

## Layout

- `kit/`: what every area uses. Among it are `run-probe.sh`, which runs any
  XCTest probe, `silence.sh`, `lock-device.sh`, `cdp.cjs`, `hx.cjs`, `ax.py` and
  `reading.cjs`. [kit/README.md](kit/README.md) lists them all.
- `fixtures/`: the EPUB generators ([fixtures/README.md](fixtures/README.md)).
- One folder per area (**Areas** below): its recipes and the scripts,
  `*Probe.swift` files and analysers they use. A short area's `README.md` holds
  its recipes. A longer one lists them, one `.md` file each, with the scripts
  and probes each documents; split a `README.md` that way once its recipes pass
  about 200 lines. A new recipe goes where the area's others are.
- `pitfalls/`: what went wrong and what fixed it, by tool rather than by area.
- `archive/`: superseded experiments kept because a recipe or the engineering
  log cites them ([archive/README.md](archive/README.md)).

Before heavy simulator work, use the shared admission and readiness gate in
[kit/ios-verification.md](kit/ios-verification.md). The runner below takes the
slot automatically; other heavy phases use the guarded CLI entry. One failed
recovery ends the attempt as BLOCKED, with evidence retained.

Any XCTest probe runs the same way, and a new one is only its Swift file in its
area's folder:

```sh
bash test/manual-test/kit/run-probe.sh AlignmentProbe SIMULATOR_UDID /tmp/openreader-alignment-01 -only-testing:METHOD
```

## Silence the simulator, never the Mac

```sh
bash test/manual-test/kit/silence.sh set SIMULATOR_UDID     # that device to zero, read back
bash test/manual-test/kit/silence.sh check SIMULATOR_UDID   # exit 2 unless it is zero
```

This writes `sim_volume` in that one device's own
`~/Library/Developer/CoreSimulator/Devices/UDID/data/var/run/simulatoraudio/audiosettings.plist`.
It is the simulated device's volume, on the 0-100 scale its volume buttons use,
and the app on it reads the same number back as `AVAudioSession.outputVolume`.
Nothing outside that device changes: not the Mac's output, not another
simulator. The UDID may be left out only when exactly one simulator is booted.

Measured on 2026-09-21 with a throwaway iOS 27.0 device, an app playing a 440 Hz
tone through `AVAudioSession(.playback)` and `AVAudioEngine`, and a CoreAudio
process tap recording what that guest process actually delivered to the host:
at `sim_volume` 60 the tap read peak `0.090000`, rms `0.063639` over 286,720
samples; at `sim_volume` 0 it read peak `0.000000`, rms `0.000000`, and the app
reported `outputVolume=0.0`. The Mac's own volume was not touched for either.

Three properties decide how to use it, all of them in [pitfalls/simulators.md](pitfalls/simulators.md): a boot
resets it to 60, an app takes the value when it activates its audio session, and
a shut-down device has no file at all. So: boot, `set`, then launch the app.
`kit/run-probe.sh` (every XCTest probe), `reading.cjs play-for`, `voice-playback.cjs` and
`offline-playback.cjs` all `check` it before they play.

## The Trial and the Unlock in a build with Debug Mode

A build with Debug Mode asks a pretend App Store that starts **as if the Unlock
were owned** (#148), so a probe that presses Play plays as it always did, with
no alert in front of it. To test the Trial, its end, the Unlock or a store out
of reach, put the pretend App Store into that state with the harness
(`{"do":"store","state":"not-started"}` and the rest), and put it back with
`{"do":"store","state":"unlocked"}`: [purchase/README.md](purchase/README.md).

## Real books

`~/Works/epub_books` is the owner's own library: long English web novels, each
split into parts of about 250 chapters (`<Book>/<Book> <start>-<end>.epub`, a
few MB each; its own README says how they were split). Take one when a generated
fixture is too tidy to show the behaviour: a part has hundreds of spine items,
chapters several screens tall and a real navigation document, which is what
section boundaries, `renderAhead`, `display()` and a chapter download meet in
the owner's actual reading.

Load a part the way any fixture is loaded: copy it into the app's
`Documents/Inbox` (`xcrun simctl get_app_container SIMULATOR_UDID
top.xujialiu.openreader data`) and add it with the harness,
`{"seq":N,"do":"add","file":"NAME.epub"}`, then open it by the Document Id the
answer names. The books are personal copies: they stay outside the repository,
and what is committed is what was measured, never their text.

## Pitfalls

What has gone wrong before, and what fixed it, one file per area. Before using a tool or touching an area, read its file; when something fails, `rg` a phrase of the error across `test/manual-test/` first. When `xcrun`, Metro, XCTest or a manual step goes wrong or misleads you, add it, with its symptom, cause and fix, to the file for its area, or to a new one listed here (MEMORY/device-testing.md).

- [Physical iPhone](pitfalls/physical-iphone.md): Physical iPhone Release builds; Physical iPhone screen; Physical iPhone logs and the lock screen's state (#66).
- [Metro and the bundle](pitfalls/metro.md).
- [Simulators, installs and the simulator's volume](pitfalls/simulators.md): Simulators and installs; Away from the screen: the lock and the background time (#75); A fresh prebuild, and volume resets through an evening (#108–#110); A volume reset in a quiet stretch (#109 round 2); the volume back at 60 after an app relaunch with no boot (#146); the volume at 60 at the start of a session with nothing played (#148); another session's probe kills the shared app and wedges AXe while it runs (#305, 2026-10-20); a gap in the Debug Log that is the Mac asleep, and a copy of a Document that is the same Document (#307); a set undone within five minutes, caught by the check in front of the play (#307, 2026-10-20).
- [Locking the device, and the app away from the screen](pitfalls/lock-and-background.md): Home and Control Center through XCTest and `axe`; locking at a moment of a download; the lock probe's build directory shared by every session, and a Lock Screen Play the app refused, which the kit's `play` test still passes and which leaves the button on Pause (#148); a refusal that republishes the same paused state, which does not turn it back on beta12 (#148 round 2); the kit's `play` failing, and xcodebuild hanging in `simctl diagnose`, once beta13 puts the button back, and `play-refused` (#148 round 3); the centre button losing its identifier on iOS 26.5, where `play-refused` fails before the tap and the failed run again hangs in `simctl diagnose` (beta20, 2026-10-17).
- [Screenshots](pitfalls/screenshots.md): Screenshots of a sheet (including one shot before its slide-in begins, #103); Screenshots of the reading page; A system alert (#109).
- [Measuring inside the reader's WebView](pitfalls/webview.md).
- [Typing, environment and silence](pitfalls/typing-environment.md): a fresh simulator's first keyboard dismissal failing an XCTest the retry passes (#146); a relaunch replaying the last `store` command, the first `HX store` line printed before the products load, and a stray consent alert when Word Lookup is switched off with its consent (#148).
- [Providers and audio](pitfalls/providers-and-audio.md): Route-loss probes, cached positions versus native freeze, LLDB's attach/continue artifacts, and a stale Fish voice-row predicate (#152); Native drift investigation (#63); Real touches on the player's head row, and Azure's own timing (#69, #70); Fish Audio from the simulator; Node probes against providers and books. Verifying #210/#209/#202/#205 (2026-10-18): axe-batch backspace drops, an AXe session dead for ten minutes mid-run and the boot that fixed it, and a lane held by a parallel session.
- [WebDAV and cross-device items](pitfalls/webdav.md): Talking to the owner's WebDAV host from the Mac; Crafting a cross-device item for #54/#55.
- [The shell](pitfalls/shell.md): `timeout` missing; zsh's `local a=$1 b=$a` (#148).
- [The simulator MCP servers](pitfalls/mcp.md): mobilebuildmcp's new names, its scheme and device defaults, installing expo-mcp; the share sheet's actions invisible to snapshot_ui/AXe, Cells to XCUITest, and synthetic taps it eats; axe's pixel coordinate space; the ~30 s automation-session wait after a boot (#95); one rendered line listed twice at one identical frame, and a lost touch-up freezing a screen transition (#103); a system alert is a `Sheet`, its Allow button answers a touch pair and not a quick tap, a masked field ignores `type_text` until revealed and focused, and a LogBox banner over Play (#109); a long text page's Copy callout, the back button's menu, and a momentum scroll (#111); `axe swipe` not moving a SwiftUI sheet where `axe drag` does, and a SwiftUI ColorPicker's well that only an XCTest tap opens (2026-10-01); a drag on a drawer's list scrolling it instead of moving the drawer, frames at 0.96 at the Drawer Height, a dark drawer's edge found only by its grabber, a list reopened where it was left after a Fast Refresh, iOS's own Look Up standing in for the app's lookup drawer while lookup is off, the page's selection callout eating a drawer's first drag, and `axe drag` not moving a WebView selection handle (#117); a virtualized Contents list with no off-screen rows for `scroll-touch`, a swipe that starts above a half-sheet closing it, and the Contents footnote eating the bottom rows' touches (#307, 2026-10-20); a row scrolled past the half-sheet's top edge touched on the reader behind it (#307 re-run, 2026-10-20); a slow `testmanagerd` on a new device and a time limit on every AXe call, typing into the phone's alert field, a Fast Refresh of the drawer, and the download probes' removed `Close Download` (#117 batch 2); a well's first XCTest tap opening nothing, a drag beside the opacity thumb, and a Fast Refresh cutting a well off from the app (#118); a Download ring that ignores `axe tap`, and copying the newest screenshot file saving the one before it (#146); a Download list's row under the header with an on-screen frame (#148); `axe drag --duration` taking seconds, so a 400 "ms" drag runs for 400 s (beta20, 2026-10-17); an AXe automation session dead for ten minutes mid-run on a session-created device, and a shutdown+boot through the shared lane restoring it in under a minute (beta6, 2026-10-18).
- [Evaluating in the app through `cdp.cjs`](pitfalls/cdp.md): `breakfetch` without `"from"` refusing nothing (`NaN`), and a shared Model list hiding a later refusal (beta20, 2026-10-17).
- [A download away from the screen](pitfalls/background-downloads.md): the simulator's bounded background time; the continued processing task's log lines (#75, #76, #77); polling every preparation, the lock's flicker and the continued task, a hotspot's `waiting`; a dead host VPN holding a download in `waiting`, and a reboot that resumes it unattended (#146).
- [Merges, seeding and past verification runs](pitfalls/verification-runs.md): Verifying #136: a `build_sim` transport timeout, and a simulator re-adopting a stale data container (2026-10-07); Verifying #134: a chapter downloaded again from memory after a deletion, and a moved `, being read` suffix (2026-10-05); Verifying #115: Play in the middle of the transport row (2026-10-01); Merging main's #67 and #68 into #71 (2026-09-26); Verifying #71 batch 2; Seeding a real book's place through the harness (#68); Independent verification of the collapsed player and its edge swipe (#67); Verifying #71 batches 3 and 4 (2026-09-26); Verifying #75: a download beside a Reading (2026-09-28); A leftover `harness.json` replays its last `add` at every relaunch and resurrects a moved-away file (#95).

### Verifying #303/#304 (r2, 2026-10-20)

Record: [`sync/play-wait-and-interruption.md`](sync/play-wait-and-interruption.md); `sync/PlayWaitProbe.swift` (XCUITest play-wait driver: press-shot at ≤500 ms, pause-inside-the-wait, the Safari interruption source, the plain regression).

- **Two ios-tester sessions drove one simulator, and each poisoned the other's evidence.** Symptom: a harness command (`seek 15`) executed mid-measurement that nobody on this side had sent; the app restarting between a staging step and the probe that needed it; synthetic input dying mid-session after working for an hour. Cause: a second tester worktree (`delete_download`) was driving the same device, its fixtures answering the same ports and its harness writes landing in the same container. Fix: create a session-owned device for every verification (`simctl create` on the iOS 26.5 runtime — see the next pitfall for why not 27.0), and treat any unexplained state change as contamination, not as an app defect.
- **A newly created iOS 27.0 simulator's first boot drove the Mac to a load of about 200 and wedged CoreSimulator** (`launchd_sim` children `SeymourServices`, `BiomeStreams`, `financed`, `cloudd`): every `simctl` call, even `list`, timed out for minutes. Fix: create session devices on the **iOS 26.5** runtime; shutting down and deleting that device cleared the wedge.
- **A refusal before testing used to terminate the staged app.** `run-probe.sh`'s cleanup killed the target on any nonzero exit, including a silence-check refusal (the volume back at 60 after an app relaunch, #146's behaviour) — so the next probe found no app and its own relaunch landed on the Library, a failure loop that looked like input death. Fix in `run-probe.sh`: only a test outcome (rc ≥ 65) stops the target.
- **`plutil -replace` on the container's `Preferences/*.plist` does not change what the app reads** — cfprefsd holds the cached defaults and wins. Pin a Debug app's Metro port with `xcrun simctl spawn UDID defaults write top.xujialiu.openreader RCT_jsLocation localhost:PORT` instead, verify by the on-screen version, and reverse it the same way. (The `docs/install-on-simulator.md` shutdown+boot path also works; the spawn-defaults form needs no boot.)
- **On the session-created r2 device, every first engine start after a fresh launch began aborting** (`AURemoteIO::Cleanup` → `_ReportRPCTimeout` → SIGABRT, ~35 s after launch), on **both** beta11 (3 of 5 presses) and beta10 served from a second Metro (4–5 of 6 identical sequences at load 3–6), while Play had sounded on the same device an hour earlier. A shutdown+boot recovery did not clear it. r3 traced it to the Mac's own sleep (next section): with the Mac kept awake the same control passed at once.

### Verifying #303/#304 (r3, 2026-10-20): the Mac's sleep, a beta12 intruder, and a silent interruption

- **The r2 aborts were the Mac's own sleep, not an app or environment defect.** `pmset -g log` showed `Sleep` at 05:56:23, a DarkWake at 06:12:06, `Sleep` again at 07:40:01, and every `_ReportRPCTimeout` ← `AURemoteIO::Cleanup` ← `mainMixerNode` abort at the first engine start (06:14:47, 06:17:04, the 06:52–07:02 baseline runs) fell in that window. With the owner's Amphetamine holding the Mac awake (`pmset -g`: `sleep 0 (sleep prevented by … Amphetamine)`), the identical fresh-launch control on the same device passed first try at load 4–5. Before dating engine-start aborts to the app or the environment, check the Mac's own sleep history (`pmset -g log | grep -E "Sleep|DarkWake"`) against the abort timestamps.
- **Date another session's interference from its app's own Debug Log, not from when a measurement looks odd.** The r1 "(d) waited again" evidence at 00:56 had measured another session's `1.0.0 (9)-beta12` bundle: the contaminated device's own `debug-log-000001.txt` opens with `[launch] … beta12 …; cleared the Debug Log of 1.0.0 (9)-beta11: 2 files, 2.0 MB` at **00:50:40** and its `version.txt` read beta12 — while the record had dated the interference "~01:04" and passed (d) on 00:48/00:56 windows. An earlier (d) failure at 00:49 ("Nothing had started 3 s after the press") had lost its app log to that same clearing launch. Around every measurement, quote the neighbouring `[launch]` lines of the device's own Debug Log; a version mismatch voids the window.
- **The iOS 26.5 simulator delivers no audio-session interruption from Safari.** With OpenReader playing, Safari on the same device was made to really play a served tone — its audio viewer showed the Pause icon with the time advancing after a confirmed tap — and OpenReader logged no `interruption.began` and kept playing. The inline `<audio controls>` page is worse: its controls are invisible to the AX tree (only scroll bars and the address field), and confirmed `axe touch`/`axe tap` deliveries never produced a page click (the page's own status line stayed `idle` across three tap strategies, including a body-onclick). An interruption scenario on the simulator is a coverage limit; whether an audible device (volume above 0, not testable under the kit's silence rules) behaves differently is open. Use a physical device.

### Verifying #260/#233/#261 (1.0.0 (9)-beta17) (2026-10-20)

Record: [`library-and-reader/library-preservation.md`](library-and-reader/library-preservation.md). Session-owned iOS 26.5 device (`iPhone 17 libfix`), Metro from the parent worktree on 8081, real-book copies as fixtures.

- **A leftover `harness.json` does not just resurrect a moved file (#95) — replayed after a data/permission restore it can commit an orphan kept file.** Symptom: while `Documents` was chmod'ed 555 for a rename-refusal check, a `sha256-….epub` with no Library entry appeared in `Documents/library/`. Cause: the last harness command (`add` of the second book) was still on disk and the app replays it at every relaunch; with the kept-files directory writable again the replayed import passed staging, **kept the file**, and only then refused at the Folder store (`library-folders.pending.json`) — `add` runs `keepFile` before `folders.place`, so a refusal in between leaves a file with no entry (identical ordering at base 77a0b91). Fix: delete `harness.json` from any restored or backed-up container before relaunching, and clear it between scenarios; treat an unexplained kept file as a replay before suspecting the app. The orphan-after-late-refusal window itself is a real (pre-existing) app behaviour, tracked separately as #309, not fixed by the #260/#233/#261 batch and not one of its claims.
- **A committed kept file carries its staging copy's timestamps, so file times cannot date a commit.** Symptom: the orphan file's birth and mtime read 16:24 — minutes before the refusal that created it. Cause: Expo's `copySync` (clonefile) preserves the source's times — the staging copy inherits the Inbox file's, and Darwin rename keeps the staged inode's — so every timestamp on `library/<id>.epub` is the *source's* arrival time, not the commit time. Fix: date imports and commits from the app's own Debug Log (`[launch]`, `[hx]` lines with millisecond stamps), never from the kept file's times.
- **`chmod 555` on a container subdirectory is a real, reversible storage-failure injection for the simulator app.** `simctl`-spawned apps run as the host user, so removing a directory's write permission genuinely fails the app's `create`/`write` there (`UnableToCreateException … You don't have permission to save the file …`), without filling the disk and without touching app code; restore with `chmod 755` and re-verify. Two limits: a permission refusal fails *before* any byte moves, so it cannot distinguish an in-place writer from an atomic one (truncation behaviour stays with the host/unit tests); and `chmod 555 Documents` also breaks the app's own side stores (harness pending, display names) — scope the injection to the store under test (`Documents/library` for the #261 staging step) and expect launch-time noise otherwise.

### Verifying #240/#245/#241/#242 (1.0.0 (9)-beta18) (2026-10-20)

Record: [`downloads/sentence-boundaries-batch.md`](downloads/sentence-boundaries-batch.md). Session-owned iOS 26.5 device (`iPhone 17 seg18`), two Metros (batch 8095, pre-batch baseline 8096 from a detached `f12eefc` worktree with `npm ci --ignore-scripts` for unpatched sentencex), the kit's fake Kokoro on 8812, `fixtures/segmentation-fixture.ts`.

- **The Library's action/Download sheets float at the app's root, so they cover the Reader and survive route changes.** A touch aimed at the reader's `Choose a Voice` landed on the still-mounted seg-en-negs Download drawer; the drawer remained through harness `open` (the Reader pushed on top of it) and through `shut` (goBack pops routes, not the sheet). Fix: close sheets through their own `Back from …` button or a grabber drag **before** navigating, and confirm by screenshot — the AX tree lists the covered sheet's rows and the Reader's rows together, so a tree alone does not say what a point touch will hit.
- **`ax.py touch LABEL` uses the frame from its own earlier tree read; Library rows scroll when a sheet closes and the touch lands on a different row's button.** Twice `Actions for seg-en-negs` opened the seg-ja sheet (and once the reverse). Fix: re-read the tree immediately before each touch, touch, then verify the sheet's own heading (`Heading | seg-…`) before touching anything inside it.
- **`cdp.cjs --eval` takes the path of a file holding one expression; an inline expression string is read as a filename** (`ENOENT … open '(() => …'`). The other kit scripts (`download-chapter.cjs`, `walk-utts.cjs`) write temp files for the same reason.
- **`fake-kokoro-two-voices.cjs` refuses nothing unless it was started with `OPENREADER_FAKE_TTS_REFUSE=<control file>`.** The env var names the file; it is read per request, so it can be rewritten mid-run — but `refuseFrom` compares against the process's own served counter, which resets at restart. And a refused chapter ends the task `done` with `failed:[chapter]` — the migration pauses only `state !== 'done'` tasks, so a genuinely unfinished/paused legacy download must be staged by slowing the fake (`OPENREADER_FAKE_TTS_DELAY_MS`) and pausing it mid-flight (`toggleTask` over CDP), not by refusing a request.
- **`debug-log.py`'s CoreDevice listing answered `no Debug Log … is the installed build one with Debug Mode?` while the log existed** at the container's `Library/Application Support/debug-log/debug-log-000001.txt` — copy that path directly (the file also names its own location in its `[launch]` line). The same launch line is the cleanest JS-switch provenance: the beta18 launch logs `cleared the Debug Log of 1.0.0 (9)-beta17`.
- **A readiness check run seconds after `simctl launch` fails on its own timing, not the environment.** The first `ios_ready.py --metro` ran 2 s after launch and found no CDP target while Metro was still bundling (14.9 s cold); the immediate recheck passed with no recovery spent. Wait for the bundle (Metro log's `iOS Bundled …`) before the first readiness check.

- **`reading.cjs state` reports `Reading handler evaluation failed` on the Library with no held Reading.** The helper requires a mounted `Player` and otherwise throws `Open a Document first`; its outer error hides that message. During the sentence-boundary batch's final parent check, the app correctly had no Reading after returning to the Library. A read-only CDP fiber check found the Reading context's `current=null`, zero Players and the expected beta18 version, proving the precondition rather than a playback failure. Use the held Reading context for this delivery check; do not start speech just to make the Player helper work.

## Areas

How each feature was tested, with its scripts and probes, one folder per area.
Read the area's README before writing a new script; **Layout** says where a new
recipe goes.

- [Downloads and offline narration](downloads/README.md): Offline narration and reader actions; Issues #13/#14: a fresh Library, Fish from empty settings, and the two destructive confirmations the other probes always cancel; The download ring, pausing, and Manage downloads' listed-chapters rule (#37, #38, #56); A download away from the screen, and beside a Reading (#75, #76, #77); A Reading paused and played with the phone locked, and the drawer beside a Reading (#75); Two fingers: Files' own selection, and the download drawer's copy (#57); Several sentences at once (#64, `download-concurrency.ts`).
- [The Library and the reader](library-and-reader/README.md): Cold Library opening; Library and reader actions drawer (long press, '...', Delete); Long-press lookup and translation (issue #73, `TranslationProbe.swift`); A long press that starts no selection, on the phone (#74, `long-press-watch.py`); Pinch and double tap on the reading page (#79, `zoom.sh`, `ZoomProbe.swift`); The reader's web content process ended (#120, `webcontent-killed.sh`).
- [Voices, providers and what is sent](voices-and-providers/README.md): The consent alert, the Privacy Policy row and the release configuration (#109, #110, #108, `consent.md`, `ConsentProbe.swift`); The answer before every clock: a Play and a voice switch left waiting for the owner (#109 round 2, `consent-hold.sh`); Voice lists at start (#24); Short lines, brackets and the Fish language hint (#23, #25); Azure Speech: configuration, the voice sheet, and word-level highlighting (#39); Sentence or paragraph requests (#61, `context-probe.ts`); The reader's sheets and the voice handover (`ReaderProbe.swift`, `voice-playback.cjs`); Paused sentence seeking after background receipt; Fish regional picker, actual simulator touch; Fish narration interruption coverage (issue #73, `FishNarrationProbe.swift`).
- [Settings screens](settings/README.md): Settings against the phone's own Settings (#48, design 0042); Font Size against Documents that set their own sizes (#17); Text Alignment and the menu it opens (#32, #33); The two Pauses: General's Reading aloud card, and the gap itself (#60, ADR 0047); General's Line position row (#71, `LinePositionProbe.swift`); General, Theme, brackets, Manage-downloads delete-all, and Fonts; The Settings version line, rows above it, and both themes (issue #30, `SettingsVersionProbe.swift`); Settings → Acknowledgements (#111, `acknowledgements-check.py`).
- [The reading place and the page following it](place-and-following/README.md): Reading across the end of a downloaded chapter, and a place kept across a renumbering (#26, #45, #46); Play with the page scrolled away, and a place on a chapter heading (#50, #51); A Contents row while paused only moves the page (#52); The page follows the line being spoken (#71, `line-follow.cjs`); A real drag during a live glide (#71, `glide-touch.cjs`, `GlideTouchProbe.swift`); The Following mark, the way back, the collapsed lock, and Continuous (#71 batches 3/4, `FollowingProbe.swift`, `hx.cjs`, `continuous-follow.cjs`); The review fixes: a pause, a re-cue, a Block crossing (#71, `follow-fixes.cjs`); A section crossed away from the screen, and the queue race (#112, `background-crossing.sh`).
- [A Contents row opens its chapter, not the top of its file](place-and-following/contents-row-fragments.md) (#307): the fragment travelling with the press in
  browse and fresh-copy runs, the `h2TopInStage` landing measurement
  (`contents-landing-probe.js`), the scroll watcher (`scroll-watch-arm.js`,
  `scroll-watch-read.js`), the control without a fragment
  (`top-of-section-probe.js`), and the first-render image race that leaves two
  first landings off.
- [The collapsed player and the held Reading](player-and-reading-held/README.md): The collapsed player, the navigation bar and the Reading Button (#67); The Reading held in the Library (#68); The Reading held on a real, long book (#68); Disabling the active Provider while a Reading is held (#68, handler probe); A real collapse and reopen during live playback (#71, `player-touch.sh`); A tap, the Skips and a Contents row while playing, with no wait (#86, `Tap86Probe`).
- [Scrolling, flings and theme colours](scrolling-and-theme/README.md): A moved highlight leaves a strip behind (#35, `leading-strip.sh`); A chapter left unstyled by a fast fling (#34); A white page behind the dark reader: on opening, and in a long fling (#27); A fast scroll that jumps by whole chapters and shows an empty page (#58); A drawer's lines in the other theme's colour (#29, `line-colour.sh`); A live theme change with a drawer already open (#29, `live-theme-drawer.sh`).
- [The lock screen and the playback icon](lock-screen/README.md): Lock-screen screenshot and button inspection; The lock screen's playing state on a physical iPhone; Inspect the simulator's playback icon resource.
- [Sync](sync/README.md): Sync: the Sync screen, the switch, and places crossing devices (#20).
- [Native audio queue (#63)](native-audio/README.md): Native queue position versus actual rendered audio (#63); Output-driven audio/position prototype (#63, validation only); Production output-driven queue (#63).
- [The Trial and the Unlock](purchase/README.md): which App Store each build asks, the harness's `store` command, and the gate, the alerts and the end of the Trial mid-use (#148); `trial-end.sh`, `download-across-end.sh` and what beta11 measured (the least Trial, a Pronunciation's resume, a Download's drawer, the Lock Screen, StoreKit on a simulator).
- [The kit](kit/README.md): Read the accessibility tree and touch what it lists (`ax.py`); Run an XCTest probe; Read runtime warnings or evaluate a targeted expression; Inspect, stop or briefly exercise the reading handler; Pull the Debug Log off the phone (#82, `debug-log.py`) and list its Debug Notes (#305, `debug-notes.py`); Ask the app on the phone (`phone-hx.cjs`, `debug-log-timeline.py`, `probes/`).

### Verifying #218/#197/#144 (1.0.0 (9)-beta1) on a 390-point iPhone (2026-10-17)

Record: [`player-and-reading-held/untimed-placement-and-player-390.md`](player-and-reading-held/untimed-placement-and-player-390.md); `fixtures/untimed-placement-fixture.ts` (the #197 book), `player-and-reading-held/untimed-placement.cjs` (seek, play, catch the utterance, hold, pause, shoot), `untimed-scroll-recorder.js` + `untimed-geometry.js` (scroll/highlight sampler and the boxOf arithmetic in the page).

- **A one-screen chapter puts #197's check out of reach and reads exactly like the bug.** The first three runs caught the long sentence with its last two lines behind the Player, in a settled state — because the whole chapter was one screen tall: the page clamps at scrollTop 140, and no placement can lift the sentence's end to the Player's top without content below it. The app was innocent: wrapping `rendition.manager.scrollBy` showed the cue's moves converging to exactly the fixed `moveFor`'s +80 pt, which the page could not take. Fix: filler paragraphs after the sentence under test (the fixture now carries them, with a comment saying why). Any device check of where the page sits needs scroll room below the measured sentence.
- **A bare `swiftc -typecheck` cannot compile an XCTest probe on this Xcode.** `XCTest.framework` ships only a `module.modulemap` (no `.swiftmodule`), so the framework resolves but every `XCTAssert*` is `cannot find in scope`, and pointing `-I` at the platform's `usr/lib/XCTest.swiftmodule` does not fix it. The compile proof is the kit's own machinery: `project.rb` + `xcodebuild build-for-testing` (`BUILD SUCCEEDED` per probe), or `run-probe.sh` when the probe runs anyway.
- **The simulator's volume was back at 60 three times in one hour** with no boot and no relaunch — the #109-round-2 behaviour again, here on a session-created iOS 27.0 device. Every one was caught by `silence.sh check` in the same command as the play, and the `&&` chain stopped before the touch. A zero is only a zero in the breath it was set.
- **A probe's own `app.terminate(); app.launch()` follows the container plist, so pin the plist when Metro is not on 8081.** `BracketsProbe` cold-launches bare; on this worktree simulator the container plist was pinned once (`plutil -replace RCT_jsLocation -string localhost:8093` + shutdown/boot, pitfalls/metro.md) and the probe's relaunch then reconnected to this Metro. `adoptInfoPlistMetroPort` leaves it alone: the plain `xcodebuild` build has no `RCTMetroPort` baked in.
- **`BracketsProbe.testDownloadStatLines` fails on its own last line against the current UI** — it taps `Close Download`, which the drawer no longer has (#117 batch 2 removed it; `PauseOrderProbe` guards the same tap with `.exists`, this probe does not, `BracketsProbe.swift:55`). The assertion under test passed first (`1 chapter downloaded` found in 4.8 s). Stale probe gesture, not an app defect; the raw `Executed 1 test, with 1 failure` names the tap, not the wait. Fixed after that run: the probe now ends at its capture and taps nothing. The label went with the old Modal drawer (`0a2dcdb`, #117) and nothing in `src/` draws it. `GeneralFontsProbe`, `ShareProbe`, `LibraryActionsProbe`, `ScrollThemeReaderProbe`, `OfflineFixProbe` and `BracketsProbe.testFlipBracketSwitch` still tap it unguarded mid-test and fail there the same way; guard each with `.exists` as `PauseOrderProbe` does, or close the sheet by its grabber, when that probe is next run.
- **AXe's automation session dies across a `simctl shutdown` + `boot`**, even on a device that had one all evening: the first `ax.py tree` after the boot timed out twice over ~4 minutes, then answered first try. The harness (`hx.cjs`) does not need AXe, so setup went through `open`/`voice`/`back` while it warmed up.

### Verifying the Block-walk migration of #184/#189/#192 (1.0.0 (8)-beta15) (2026-10-14)

Record: [`downloads/walk-block-migration.md`](downloads/walk-block-migration.md); `downloads/walk-utts.cjs` reads the open Reading's Utterance list off the React fiber tree through CDP (`OPENREADER_METRO=… node downloads/walk-utts.cjs`; needs a Document open, reads the list, not the painted highlight).

- **The per-character `axe batch` typing recipe lost 1 of the 51 key characters on its first try** (typed 51 steps, the revealed field read back 50, first differing index 1; Fish answered the Enable with a 401). The same recipe had landed all 51 first try on the beta14 run above. Fix, before trusting any Enable: tap Show API key and compare the field's value against the source in memory (never printed); on mismatch, clear the field with one `key-sequence --keycodes 42,42,…` step of ~80 backspaces (a `key-sequence --keycodes 224,4,225` select-all did **not** select the field's text), retype, re-compare — the second typed batch compared exactly equal and Enable passed with "Connection successful".
- **Inside `axe batch`, `key-sequence` and `key` steps want `--keycodes`; the standalone help's positional form fails.** `key-sequence 42` as a batch step exits 1 with `ArgumentParser.CommandError` naming only the step kind; `key-sequence --keycodes 42` runs. The standalone command's own examples are positional — the two parsers differ.
- **The Download drawer's "N chapters downloaded" and row marks answer the drawer's own voice, not the Document's saved audio.** With the Document's Voice still unset, a finished download shows "0 chapters downloaded" and no row marked `, downloaded`, while Manage downloads lists everything — the exact shape the #184 walk reset produces. Tap the drawer's "Use downloaded voice · …" row (or set the voice before downloading) and the checks appear. Check which voice the drawer header shows before reading a lost-check state as the migration.
- **A paused seek to a heading can land on the book's own ToC row instead of
  the chapter's heading**: Shadow Slave's ToC holds "Chapter 1: Nightmare
  Begins" (one line, one Utterance, a plain space) pages before the chapter's
  own `Chapter 1:<br/><span>Nightmare Begins</span>` heading (a second
  Utterance, text `Chapter 1:\nNightmare Begins`). Collect every match of the
  pattern from the Utterance list and pick by the text's shape (the newline),
  not the first hit.

### Verifying #191/#198/#193 (1.0.0 (8)-beta14): the page's finger fixes (2026-10-14)

- **`axe batch` piped steps on stdin do nothing unless `--stdin` is passed, and
  exit 64 says so only as a usage error.** The first 51-character key typing ran
  `axe batch --udid UDID` with the steps on stdin: exit 64 (EX_USAGE), no
  per-step output, field still empty. Fix: `axe batch --udid UDID --stdin`
  (or `--file`/`--step`); then per-character `type` steps with `sleep 0.2`
  landed all 51 characters first try, exactly as #228's recipe says.
- **A revealed SecretField's value is echoed by the AX tree.** After typing the
  Fish API key with Show API key on, `ax.py tree` printed the whole key as the
  TextField's value (the #228 masked-field note is about the masked state; the
  revealed state leaks it instead). Keep tree reads out of logs and reports
  until the key is hidden again, and screenshot only the hidden state.
- **The simulator's volume returned to 60 three times in about 20 minutes,
  with no boot and no app relaunch** (after consent, before a scenario play,
  and before another). Each was caught by `silence.sh check` immediately before
  the play, and its exit 2 killed the `&&` chain before the touch, as designed —
  one chain's Play silently not happening is the documented alternative. Set
  and check in the same breath as every play; a morning-old zero is not a zero.
- **The iOS selection callout eats the lookup Drawer's close drag while the
  looked-up word is still selected** (#117's pitfall again, in the #193 flow).
  Both close drags from the grabber did nothing while Copy | Look Up |
  Translate stood over it. Fix: dismiss the selection first with one ordinary
  tap on the page — with the Drawer up the app's lookup guard eats that tap, so
  the Reading does not move — then drag the grabber down.
- **Tapping a link with the Player collapsed needs the Reading inside the
  link's own section first**, because collapsed the page only follows and
  cannot be scrolled or browsed anywhere. Setup, not a defect: place the
  Reading with the harness's `seek` (binary-search the utterance, reading
  `section=` off the status line between seeks), collapse by real touch, then
  re-probe the link rows (collapse does not reflow) and tap.

### Verifying #166/#168/#177: the controlled cache, the stall, and the probe builds (2026-10-13)

Record: [`sync/cache-stall-and-recovery.md`](sync/cache-stall-and-recovery.md).

- **`res.writeHead(...)` alone sends nothing: Node buffers the header bytes
  until the first write/end, so a "send headers then stall" test server
  measures a headers timeout while believing it measures a body timeout.**
  The first #168 run's `closed after 15018 ms` was exactly that; caught
  because `curl --max-time 2 --dump-header` received **0 bytes**. Fix: call
  `res.flushHeaders()` immediately after `writeHead` in any stall branch,
  and prove the client sees the headers (`curl -D` shows `200` +
  `Content-Length` before the hang).
- **expo/fetch (57.0.24) resolves `fetch()` at the first body chunk, not at
  the response's headers.** Measured on the simulator: body held 8 s → the
  response object and `.text()` completed together at 8 s; zero body bytes →
  `fetch()` still unresolved at 20 s (abort rejected it); half the body →
  resolved at +87 ms with `.text()` hanging. So a stall with no body bytes
  bounds at `fetch()`, and the shape the old header-only timeout could not
  bound is *headers + at least one body byte, then stall* — stall fixtures
  for body-timeout work must deliver some body bytes first.
- **A response without a `Date` header is not stored by the iOS URL cache at
  all — so a cache probe shows *no caching*, not caching that expires.** The
  controlled stub's GET first answered `Cache-Control: public, max-age=3600`,
  a backdated `Last-Modified` and an `ETag`; on the simulator, plain fetches
  then hit the server every time, which reads like "expo fetch bypasses the
  cache". Adding `Date` made the same responses cached and stale-served
  immediately (a plain fetch answered from the cache with no request
  reaching the server). Symptom: a negative control that cannot reproduce
  staleness. Cause: NSURLCache declining to store the response. Fix: send
  `Date` on every cacheable answer a probe server writes.
- **A bash-tool timeout kills a running `run-probe.sh` mid-build**, and the
  killed run's `test-STAMP.log` has no `Executed` line at all — it is not a
  failed test, it is a build that never finished. The probe project for a
  fresh output dir builds for minutes on a loaded machine (one run: 848 s
  wall, of which the test itself was 8 s). Fix: start the probe under
  `nohup … &` writing its own log, then poll for `Executed`/`PROBE-EXIT`;
  the output dir is reused only for the same probe from the same worktree,
  so the rebuild after a kill is incremental.
- **`build_run_sim`'s 60 s MCP timeout can fire before xcodebuild even
  spawns** when the machine is loaded (the documented #125 timeout had the
  build running; this one did not). Check `ps aux | grep xcodebuild` for the
  destination UDID before concluding a build is in flight; if none exists,
  fall back to the guide's manual `xcodebuild … build` under `nohup` and
  poll the log for `EXIT=`. Point `TMPDIR` at the build's own directory via
  `ios/.xcode.env.local` first: the bundle phase's `--reset-cache` clears
  the shared `os.tmpdir()/metro-cache` other Metros on the machine are using.
- **`axe` is not on PATH.** `ax.py` finds it under `~/.npm/_npx`; a bare
  `axe drag …` fails with `command not found`. Use the full path
  (`~/.npm/_npx/<hash>/node_modules/mobilebuildmcp/bundled/axe`) for drags
  and point touches, or `python3 test/manual-test/kit/ax.py` for what it
  wraps.
- **`ax.py touch LABEL` touches the first element with that label — the
  row's `StaticText`, not the switch beside it.** Touching the Sync screen's
  `Keep my place across devices` label left the switch at `1`; the switch is
  the `CheckBox` whose own frame is at the row's right edge. Fix: read the
  CheckBox's frame from the tree and touch its centre with `axe touch -x -y
  --down --up` (points).

### #125 Release verification tooling (2026-10-03)

- `mobilebuildmcp build_sim` returned `MCP request timed out after 60000ms`
  while its `xcodebuild` was still running. This was a transport deadline,
  not a failed build: the retained raw log ended `BUILD SUCCEEDED`. Wait for
  that exact PID with a bounded foreground poll before retrying; the subsequent
  incremental build also succeeded. Never launch a competing build on timeout.
- A Contents list swipe and list drag at the half-height sheet left the same
  rows visible. Expanding using the exposed sheet grabber, then dragging the
  list, moved from early chapters to XVIII–XXXV. This gesture variation isolates
  the automation/sheet interaction; it is not evidence of unreachable rows.
- A delayed reuse of an MCP ref returned `SNAPSHOT_EXPIRED` before dispatch.
  Refreshing `snapshot_ui` and repeating the touch down/up (0.2 s) succeeded.
- An ad hoc EPUB inspection imported unavailable Python `lxml`; use standard
  library `zipfile` and `xml.etree.ElementTree` instead. No book conversion or
  modification is needed to compare section-start text with screenshots.

### Release-check credential input diagnosis (2026-10-03)

- Credential edits autosave to Keychain, **not** `Documents/settings.json`.
  An absent settings file on fresh defaults says nothing about key entry.
  Configure while the provider is disabled; enabling tests the connection and
  locks the field. Do not infer an invalid source key from incomplete input.
- AXe can report successful typing while delivering no text. On build 3 / iOS
  27.0, the benign one-step stdin batch `type S` left the focused field empty;
  adding `sleep 1` **inside the same batch** produced exact `S`. A sleep after
  a separate AXe process did not repair lost input. This isolates the short
  HID-session lifetime, not Keychain persistence. A fast whole-string attempt
  also remounted as `Senti`, not `Sentinel123`; its precise truncation boundary
  was not instrumented. One stdin batch with one character per `type` step,
  `sleep 0.2` between characters and final `sleep 1` yielded exact
  `Sentinel123` both immediately and after leaving/reopening the provider page.
  The same masked-input path then passed a real local-test connection check.
  Keep secrets out of arguments, files, stdout, trees and XCTest activity logs;
  construct stdin in memory, suppress command output, and clear the clipboard.
- Files picker rows remain invisible to the app's AX tree. Coordinate units
  matter: AXe `touch` uses points, `tap` uses screenshot pixels. Sending pixel
  coordinates to `touch` caused no-op selections; the correct point-space touch
  imported the original EPUB. An immediate screenshot can precede navigation.
- Silence checks caught volume 60 twice after earlier zero readings, blocking
  Play as intended. Recheck immediately before each playback; no silence result
  is valid for an entire session.

### Verifying #228: `axe batch` tap space, and the masked key field (2026-10-12)

- **An `axe batch` of 107 steps reported `✓ Batch completed successfully` and
  typed nothing.** The steps were `tap -x 344 -y 282` (focus the API key field)
  followed by per-character `type` steps, in one stdin batch. Batch `tap` uses
  the screenshot pixel space, like the standalone `tap`; point-space
  coordinates (what `ax.py find` returns) landed both taps in the header, the
  field never had focus, and the characters went nowhere — with exit 0 and no
  per-step complaint. Fix: use point-space `touch -x -y --down --up` steps in
  batches, and screenshot the target's focused state (keyboard up, cursor in
  the field) before the first `type` step. The standalone tools' split —
  `touch` points, `tap` pixels — applies inside `batch` too.
- **The masked provider key field reads back empty until revealed.** After the
  text was provably in (masked dots on screen), `axe describe-ui` and the AX
  tree both reported the secure field's value as length 0. Tap **Show API key**
  (its frame does not move when the keyboard rises; the form does not scroll on
  this screen) and the same readback then returns the exact text. Per-character
  HID `type` steps with `sleep 0.2` between them, into the focused revealed
  field, landed all 51 characters exactly on the first focused attempt.

### Verifying #155/#216/#154/#160: sync setup, the Voice sheet, the consent hold, and the volume (2026-10-13)

Record: [`sync/self-stop-writes-and-syncs.md`](sync/self-stop-writes-and-syncs.md).

- **Ten-character `typeText` chunks lost characters in the Sync screen's
  Address field.** Typing the 79-character test-folder URL read back
  `hs://…` — the app's own check then refused it with "The WebDAV URL must
  start with http:// or https://.", and the switch never turned on. The
  controlled field re-renders per keystroke and a fast chunk still outraces
  it. Fix: put `sync.url` and `sync.username` in with the harness settings
  patch and type only the password, per character with a pause
  (`sync/SyncSetupProbe.swift` asserts the fields show the caller's values
  instead of typing them).
- **The Voice sheet stands over the Play button, and the AX tree still lists
  Play behind it.** On a fresh Document, Play opens the Voice sheet by design
  (the Document has no Voice of its own yet); `ax.py find Play` then returns
  the off-screen button's frame, touches land on the sheet, and the reading
  never starts. Fix: choose the voice row, close the sheet with an `axe drag`
  down its title (start-x/y at the title row, end 400 pt lower), and confirm
  the tree's Play line came back before touching it.
- **The consent alert holds the first Play with nothing on the status line.**
  `say` keeps printing `playing=false … note=null` while the engine waits in
  `consent.ensure`; the alert is only in the AX tree as a Sheet, and the
  screenshots taken before synthesis show nothing. Fix: after the first Play
  of a fresh provider setup, run `ax.py tree | grep Allow` and answer with
  `ax.py alert-touch Allow`; the clips then fetch at once. The lookup's own
  Youdao alert appears the same way over the drawer.
- **The simulator's volume was back at 60 four times in one session with no
  boot** — after the app relaunches a probe makes (#146) and twice in quiet
  stretches. A `silence.sh check` failure also kills a `&&` chain, and a chain
  ended with `&` backgrounds the whole chain, not just its last command — the
  play silently never happened. Fix: `silence.sh set` immediately before every
  play and keep the play in a call of its own.
- **AXe's `touch` takes `-x`/`-y` with one dash but `--udid`, `--down`,
  `--up`, `--delay` with two.** `--x` fails with "Missing expected argument
  '-x'", `-udid` with "Missing expected argument '--udid'"; the error names
  only the first missing flag. The working long press on a reader word is
  `axe touch -x X -y Y --down --up --delay 2.0 --udid UDID`, in points.

### Verifying #226/#227/#180/#215: the Files picker, a wedged fresh device, and autocorrect in the Rename alert (2026-10-13)

- **iOS autocorrect rewrites words typed per character into the Rename
  alert's field.** `alert-input.py` typed `Unwritable Name` and the native
  field read `Uneditable Name`; a retry with `Qzw Kxv` read `Wow Kxv` — each
  time the first word was substituted, the per-character typing with pauses
  giving QuickType a window to act, and the helper failed closed both times
  (field left unsubmitted, as its contract requires). Fix: type a token
  autocorrect will not touch (a non-word such as `Qzwkxv9`); the next round
  then passed exact native readback. Real words that typed exactly earlier in
  the same session (`School Copy`, `Gap Book`) are no guarantee for the next
  word.
- **A fresh simulator's AXe automation session took ~4–5 minutes to come up,
  not the documented ~30 s.** After the app's first successful launch on a
  device created that hour, `ax.py tree` answered `Timed out creating the
  simulator remote automation session` twice and `snapshot_ui` answered `No
  translation object returned for simulator` once across four minutes; every
  read after that answered first try. Screenshots and `simctl` calls worked
  throughout. Fix: retry over minutes before concluding automation is broken.
- **A fresh device can wedge silently after a successful install: no error,
  only hangs.** `simctl install` answered, then `simctl launch` hung past
  120 s, and `spawn … launchctl list` and `io screenshot` hung too, with the
  device shown `Booted` throughout — the same failure as the wedges recorded
  above but with silence instead of `Mach error -308` or a bootstatus stall.
  Fix, the same: `simctl shutdown` that one UDID (answered cleanly), boot
  again, `silence.sh set` (the boot resets the volume), relaunch with
  `-RCT_jsLocation`; every later call then answered first try.
- **The document picker's back chevron from a staged subfolder opens the
  Browse **Locations** list (iCloud Drive / On My iPhone), not the parent
  folder grid.** Twice a tap aimed at the grid's middle column landed on
  iCloud Drive in that list because the previous screen was assumed. The
  picker otherwise matched the #121 recipe exactly: only its Cancel leaks
  into the AX tree, it remembers its last folder across presentations, and
  the file rows sit at the same fixed columns (points ≈ 70/201/331 on this
  402 pt screen). Screenshot, points = px/3, verify each step by the next
  screenshot.
- **A handover or import name collides only when the folded names match —
  punctuation is not folded.** Handing over `gap-book.epub` beside a
  Document called `Gap Book` correctly asked nothing (hyphen ≠ space), which
  reads as a miss if the fixture name was chosen expecting case-only
  differences. Choose the file's name to differ from the sibling by letter
  case alone (`Gap Book.epub`) when the `Name already exists` alert is the
  target.
