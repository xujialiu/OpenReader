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
- [Simulators, installs and the simulator's volume](pitfalls/simulators.md): Simulators and installs; Away from the screen: the lock and the background time (#75); A fresh prebuild, and volume resets through an evening (#108–#110); A volume reset in a quiet stretch (#109 round 2).
- [Locking the device, and the app away from the screen](pitfalls/lock-and-background.md): Home and Control Center through XCTest and `axe`; locking at a moment of a download.
- [Screenshots](pitfalls/screenshots.md): Screenshots of a sheet (including one shot before its slide-in begins, #103); Screenshots of the reading page; A system alert (#109).
- [Measuring inside the reader's WebView](pitfalls/webview.md).
- [Typing, environment and silence](pitfalls/typing-environment.md).
- [Providers and audio](pitfalls/providers-and-audio.md): Native drift investigation (#63); Real touches on the player's head row, and Azure's own timing (#69, #70); Fish Audio from the simulator; Node probes against providers and books.
- [WebDAV and cross-device items](pitfalls/webdav.md): Talking to the owner's WebDAV host from the Mac; Crafting a cross-device item for #54/#55.
- [The shell](pitfalls/shell.md).
- [The simulator MCP servers](pitfalls/mcp.md): mobilebuildmcp's new names, its scheme and device defaults, installing expo-mcp; the share sheet's actions invisible to snapshot_ui/AXe, Cells to XCUITest, and synthetic taps it eats; axe's pixel coordinate space; the ~30 s automation-session wait after a boot (#95); one rendered line listed twice at one identical frame, and a lost touch-up freezing a screen transition (#103); a system alert is a `Sheet`, its Allow button answers a touch pair and not a quick tap, a masked field ignores `type_text` until revealed and focused, and a LogBox banner over Play (#109); a long text page's Copy callout, the back button's menu, and a momentum scroll (#111); `axe swipe` not moving a SwiftUI sheet where `axe drag` does, and a SwiftUI ColorPicker's well that only an XCTest tap opens (2026-10-01); a drag on a drawer's list scrolling it instead of moving the drawer, frames at 0.96 at the Drawer Height, a dark drawer's edge found only by its grabber, a list reopened where it was left after a Fast Refresh, iOS's own Look Up standing in for the app's lookup drawer while lookup is off, the page's selection callout eating a drawer's first drag, and `axe drag` not moving a WebView selection handle (#117); a slow `testmanagerd` on a new device and a time limit on every AXe call, typing into the phone's alert field, a Fast Refresh of the drawer, and the download probes' removed `Close Download` (#117 batch 2); a well's first XCTest tap opening nothing, a drag beside the opacity thumb, and a Fast Refresh cutting a well off from the app (#118).
- [Evaluating in the app through `cdp.cjs`](pitfalls/cdp.md).
- [A download away from the screen](pitfalls/background-downloads.md): the simulator's bounded background time; the continued processing task's log lines (#75, #76, #77); polling every preparation, the lock's flicker and the continued task, a hotspot's `waiting`.
- [Merges, seeding and past verification runs](pitfalls/verification-runs.md): Verifying #115: Play in the middle of the transport row (2026-10-01); Merging main's #67 and #68 into #71 (2026-09-26); Verifying #71 batch 2; Seeding a real book's place through the harness (#68); Independent verification of the collapsed player and its edge swipe (#67); Verifying #71 batches 3 and 4 (2026-09-26); Verifying #75: a download beside a Reading (2026-09-28); A leftover `harness.json` replays its last `add` at every relaunch and resurrects a moved-away file (#95).

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
- [The kit](kit/README.md): Read the accessibility tree and touch what it lists (`ax.py`); Run an XCTest probe; Read runtime warnings or evaluate a targeted expression; Inspect, stop or briefly exercise the reading handler; Pull the Debug Log off the phone (#82, `debug-log.py`); Ask the app on the phone (`phone-hx.cjs`, `debug-log-timeline.py`, `probes/`).

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
