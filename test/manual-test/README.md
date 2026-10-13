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
- [Simulators, installs and the simulator's volume](pitfalls/simulators.md): Simulators and installs; Away from the screen: the lock and the background time (#75); A fresh prebuild, and volume resets through an evening (#108–#110); A volume reset in a quiet stretch (#109 round 2); the volume back at 60 after an app relaunch with no boot (#146); the volume at 60 at the start of a session with nothing played (#148).
- [Locking the device, and the app away from the screen](pitfalls/lock-and-background.md): Home and Control Center through XCTest and `axe`; locking at a moment of a download; the lock probe's build directory shared by every session, and a Lock Screen Play the app refused, which the kit's `play` test still passes and which leaves the button on Pause (#148); a refusal that republishes the same paused state, which does not turn it back on beta12 (#148 round 2); the kit's `play` failing, and xcodebuild hanging in `simctl diagnose`, once beta13 puts the button back, and `play-refused` (#148 round 3).
- [Screenshots](pitfalls/screenshots.md): Screenshots of a sheet (including one shot before its slide-in begins, #103); Screenshots of the reading page; A system alert (#109).
- [Measuring inside the reader's WebView](pitfalls/webview.md).
- [Typing, environment and silence](pitfalls/typing-environment.md): a fresh simulator's first keyboard dismissal failing an XCTest the retry passes (#146); a relaunch replaying the last `store` command, the first `HX store` line printed before the products load, and a stray consent alert when Word Lookup is switched off with its consent (#148).
- [Providers and audio](pitfalls/providers-and-audio.md): Route-loss probes, cached positions versus native freeze, LLDB's attach/continue artifacts, and a stale Fish voice-row predicate (#152); Native drift investigation (#63); Real touches on the player's head row, and Azure's own timing (#69, #70); Fish Audio from the simulator; Node probes against providers and books.
- [WebDAV and cross-device items](pitfalls/webdav.md): Talking to the owner's WebDAV host from the Mac; Crafting a cross-device item for #54/#55.
- [The shell](pitfalls/shell.md): `timeout` missing; zsh's `local a=$1 b=$a` (#148).
- [The simulator MCP servers](pitfalls/mcp.md): mobilebuildmcp's new names, its scheme and device defaults, installing expo-mcp; the share sheet's actions invisible to snapshot_ui/AXe, Cells to XCUITest, and synthetic taps it eats; axe's pixel coordinate space; the ~30 s automation-session wait after a boot (#95); one rendered line listed twice at one identical frame, and a lost touch-up freezing a screen transition (#103); a system alert is a `Sheet`, its Allow button answers a touch pair and not a quick tap, a masked field ignores `type_text` until revealed and focused, and a LogBox banner over Play (#109); a long text page's Copy callout, the back button's menu, and a momentum scroll (#111); `axe swipe` not moving a SwiftUI sheet where `axe drag` does, and a SwiftUI ColorPicker's well that only an XCTest tap opens (2026-10-01); a drag on a drawer's list scrolling it instead of moving the drawer, frames at 0.96 at the Drawer Height, a dark drawer's edge found only by its grabber, a list reopened where it was left after a Fast Refresh, iOS's own Look Up standing in for the app's lookup drawer while lookup is off, the page's selection callout eating a drawer's first drag, and `axe drag` not moving a WebView selection handle (#117); a slow `testmanagerd` on a new device and a time limit on every AXe call, typing into the phone's alert field, a Fast Refresh of the drawer, and the download probes' removed `Close Download` (#117 batch 2); a well's first XCTest tap opening nothing, a drag beside the opacity thumb, and a Fast Refresh cutting a well off from the app (#118); a Download ring that ignores `axe tap`, and copying the newest screenshot file saving the one before it (#146); a Download list's row under the header with an on-screen frame (#148).
- [Evaluating in the app through `cdp.cjs`](pitfalls/cdp.md).
- [A download away from the screen](pitfalls/background-downloads.md): the simulator's bounded background time; the continued processing task's log lines (#75, #76, #77); polling every preparation, the lock's flicker and the continued task, a hotspot's `waiting`; a dead host VPN holding a download in `waiting`, and a reboot that resumes it unattended (#146).
- [Merges, seeding and past verification runs](pitfalls/verification-runs.md): Verifying #136: a `build_sim` transport timeout, and a simulator re-adopting a stale data container (2026-10-07); Verifying #134: a chapter downloaded again from memory after a deletion, and a moved `, being read` suffix (2026-10-05); Verifying #115: Play in the middle of the transport row (2026-10-01); Merging main's #67 and #68 into #71 (2026-09-26); Verifying #71 batch 2; Seeding a real book's place through the harness (#68); Independent verification of the collapsed player and its edge swipe (#67); Verifying #71 batches 3 and 4 (2026-09-26); Verifying #75: a download beside a Reading (2026-09-28); A leftover `harness.json` replays its last `add` at every relaunch and resurrects a moved-away file (#95).

## Areas

How each feature was tested, with its scripts and probes, one folder per area.
Read the area's README before writing a new script; **Layout** says where a new
recipe goes.

- [Downloads and offline narration](downloads/README.md): Offline narration and reader actions; Issues #13/#14: a fresh Library, Fish from empty settings, and the two destructive confirmations the other probes always cancel; The download ring, pausing, and Manage downloads' listed-chapters rule (#37, #38, #56); A download away from the screen, and beside a Reading (#75, #76, #77); A Reading paused and played with the phone locked, and the drawer beside a Reading (#75); Two fingers: Files' own selection, and the download drawer's copy (#57); Several sentences at once (#64, `download-concurrency.ts`).
- [The Library and the reader](library-and-reader/README.md): Cold Library opening; Library and reader actions drawer (long press, '...', Delete); Long-press lookup and translation (issue #73, `TranslationProbe.swift`); A long press that starts no selection, on the phone (#74, `long-press-watch.py`); Pinch and double tap on the reading page (#79, `zoom.sh`, `ZoomProbe.swift`); The reader's web content process ended (#120, `webcontent-killed.sh`).
- [Voices, providers and what is sent](voices-and-providers/README.md): The consent alert, the Privacy Policy row and the release configuration (#109, #110, #108, `consent.md`, `ConsentProbe.swift`); The answer before every clock: a Play and a voice switch left waiting for the owner (#109 round 2, `consent-hold.sh`); Voice lists at start (#24); Short lines, brackets and the Fish language hint (#23, #25); Azure Speech: configuration, the voice sheet, and word-level highlighting (#39); Sentence or paragraph requests (#61, `context-probe.ts`); The reader's sheets and the voice handover (`ReaderProbe.swift`, `voice-playback.cjs`); Paused sentence seeking after background receipt; Fish regional picker, actual simulator touch; Fish narration interruption coverage (issue #73, `FishNarrationProbe.swift`).
- [Settings screens](settings/README.md): Settings against the phone's own Settings (#48, design 0042); Font Size against Documents that set their own sizes (#17); Text Alignment and the menu it opens (#32, #33); The two Pauses: General's Reading aloud card, and the gap itself (#60, ADR 0047); General's Line position row (#71, `LinePositionProbe.swift`); General, Theme, brackets, Manage-downloads delete-all, and Fonts; The Settings version line, rows above it, and both themes (issue #30, `SettingsVersionProbe.swift`); Settings → Acknowledgements (#111, `acknowledgements-check.py`).
- [The reading place and the page following it](place-and-following/README.md): Reading across the end of a downloaded chapter, and a place kept across a renumbering (#26, #45, #46); Play with the page scrolled away, and a place on a chapter heading (#50, #51); A Contents row while paused only moves the page (#52); The page follows the line being spoken (#71, `line-follow.cjs`); A real drag during a live glide (#71, `glide-touch.cjs`, `GlideTouchProbe.swift`); The Following mark, the way back, the collapsed lock, and Continuous (#71 batches 3/4, `FollowingProbe.swift`, `hx.cjs`, `continuous-follow.cjs`); The review fixes: a pause, a re-cue, a Block crossing (#71, `follow-fixes.cjs`); A section crossed away from the screen, and the queue race (#112, `background-crossing.sh`).
- [The collapsed player and the held Reading](player-and-reading-held/README.md): The collapsed player, the navigation bar and the Reading Button (#67); The Reading held in the Library (#68); The Reading held on a real, long book (#68); Disabling the active Provider while a Reading is held (#68, handler probe); A real collapse and reopen during live playback (#71, `player-touch.sh`); A tap, the Skips and a Contents row while playing, with no wait (#86, `Tap86Probe`).
- [Scrolling, flings and theme colours](scrolling-and-theme/README.md): A moved highlight leaves a strip behind (#35, `leading-strip.sh`); A chapter left unstyled by a fast fling (#34); A white page behind the dark reader: on opening, and in a long fling (#27); A fast scroll that jumps by whole chapters and shows an empty page (#58); A drawer's lines in the other theme's colour (#29, `line-colour.sh`); A live theme change with a drawer already open (#29, `live-theme-drawer.sh`).
- [The lock screen and the playback icon](lock-screen/README.md): Lock-screen screenshot and button inspection; The lock screen's playing state on a physical iPhone; Inspect the simulator's playback icon resource.
- [Sync](sync/README.md): Sync: the Sync screen, the switch, and places crossing devices (#20).
- [Native audio queue (#63)](native-audio/README.md): Native queue position versus actual rendered audio (#63); Output-driven audio/position prototype (#63, validation only); Production output-driven queue (#63).
- [The Trial and the Unlock](purchase/README.md): which App Store each build asks, the harness's `store` command, and the gate, the alerts and the end of the Trial mid-use (#148); `trial-end.sh`, `download-across-end.sh` and what beta11 measured (the least Trial, a Pronunciation's resume, a Download's drawer, the Lock Screen, StoreKit on a simulator).
- [The kit](kit/README.md): Read the accessibility tree and touch what it lists (`ax.py`); Run an XCTest probe; Read runtime warnings or evaluate a targeted expression; Inspect, stop or briefly exercise the reading handler; Pull the Debug Log off the phone (#82, `debug-log.py`); Ask the app on the phone (`phone-hx.cjs`, `debug-log-timeline.py`, `probes/`).

### Verifying #166/#168/#177: the controlled cache, the stall, and the probe builds (2026-10-13)

Record: [`sync/cache-stall-and-recovery.md`](sync/cache-stall-and-recovery.md).

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
