# Device and manual tests

Before writing a script, inspect this directory and reuse or extend the relevant
one. Save useful new reproduction, inspection and verification scripts here as
soon as they work. Document the invocation, prerequisites, expected result and
what the script cannot prove. One-off probes may stay temporary; a working tool
needed for the next run belongs here.

Keep generated Xcode projects, builds, logs and screenshots outside the
repository. Accept device IDs and artifact destinations as arguments. Load only
needed credentials from `~/.secrets/openreader/`; never print or commit their values.
Follow the simulator installation guide, MEMORY/device-testing.md's silence and playback-duration
requirements, and MEMORY/app-change.md's final-running-app requirement. Choose playback duration for the fact being
measured, and stop immediately afterwards, including after failures.

## Silence the simulator, never the Mac

```sh
bash test/manual-test/silence.sh set SIMULATOR_UDID     # that device to zero, read back
bash test/manual-test/silence.sh check SIMULATOR_UDID   # exit 2 unless it is zero
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
`lock-screen.sh` (tap mode), `reading.cjs play-for`, `voice-playback.cjs` and
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
- [Simulators, installs and the simulator's volume](pitfalls/simulators.md): Simulators and installs; Away from the screen: the lock and the background time (#75).
- [Locking the device, and the app away from the screen](pitfalls/lock-and-background.md): Home and Control Center through XCTest and `axe`; locking at a moment of a download.
- [Screenshots](pitfalls/screenshots.md): Screenshots of a sheet; Screenshots of the reading page.
- [Measuring inside the reader's WebView](pitfalls/webview.md).
- [Typing, environment and silence](pitfalls/typing-environment.md).
- [Providers and audio](pitfalls/providers-and-audio.md): Native drift investigation (#63); Real touches on the player's head row, and Azure's own timing (#69, #70); Fish Audio from the simulator; Node probes against providers and books.
- [WebDAV and cross-device items](pitfalls/webdav.md): Talking to the owner's WebDAV host from the Mac; Crafting a cross-device item for #54/#55.
- [The shell](pitfalls/shell.md).
- [The simulator MCP servers](pitfalls/mcp.md): mobilebuildmcp's new names, its scheme and device defaults, installing expo-mcp.
- [Evaluating in the app through `cdp.cjs`](pitfalls/cdp.md).
- [A download away from the screen](pitfalls/background-downloads.md): the simulator's bounded background time; the continued processing task's log lines (#75, #76, #77); polling every preparation, the lock's flicker and the continued task, a hotspot's `waiting`.
- [Merges, seeding and past verification runs](pitfalls/verification-runs.md): Merging main's #67 and #68 into #71 (2026-09-26); Verifying #71 batch 2; Seeding a real book's place through the harness (#68); Independent verification of the collapsed player and its edge swipe (#67); Verifying #71 batches 3 and 4 (2026-09-26); Verifying #75: a download beside a Reading (2026-09-28).

## Recipes

How a feature was tested, with its scripts and probes, one file per area. Read the file for the feature you are testing before writing a new script; add a new recipe to the file for its area.

- [The lock screen and the playback icon](recipes/lock-screen.md): Lock-screen screenshot and button inspection; The lock screen's playing state on a physical iPhone; Inspect the simulator's playback icon resource.
- [Runtime warnings, expressions and the reading handler](recipes/runtime.md): Read runtime warnings or evaluate a targeted expression; Inspect, stop or briefly exercise the reading handler.
- [The collapsed player and the held Reading](recipes/player-and-reading-held.md): The collapsed player, the navigation bar and the Reading Button (#67); The Reading held in the Library (#68); The Reading held on a real, long book (#68); Disabling the active Provider while a Reading is held (#68, handler probe); A real collapse and reopen during live playback (#71, `player-touch.sh`).
- [Reader drawers, the Library and the XCTest probes](recipes/drawers-library-and-probes.md): Cold Library opening; Offline narration and reader actions; The download ring, pausing, and Manage downloads' listed-chapters rule (#37, #38, #56); A download away from the screen, and beside a Reading (#75, #76, #77); A Reading paused and played with the phone locked, and the drawer beside a Reading (#75); Two fingers: Files' own selection, and the download drawer's copy (#57); Paused sentence seeking after background receipt; Fish regional picker, actual simulator touch; Library and reader actions drawer (long press, '...', Delete); General, Theme, brackets, Manage-downloads delete-all, and Fonts; The Settings version line, rows above it, and both themes (issue #30, `SettingsVersionProbe.swift`); Long-press lookup and translation (issue #73, `TranslationProbe.swift`); Fish narration interruption coverage (issue #73, `FishNarrationProbe.swift`); Issues #13/#14: a fresh Library, Fish from empty settings, and the two; destructive confirmations the other probes always cancel; Pinch and double tap on the reading page (#79, `zoom.sh`, `ZoomProbe.swift`).
- [Settings screens](recipes/settings.md): Settings against the phone's own Settings (#48, design 0042); Font Size against Documents that set their own sizes (#17); Text Alignment and the menu it opens (#32, #33); The two Pauses: General's Reading aloud card, and the gap itself (#60, ADR 0047); General's Line position row (#71, `line-position.sh`, `LinePositionProbe.swift`).
- [Sync](recipes/sync.md): Sync: the Sync screen, the switch, and places crossing devices (#20).
- [Voices, providers and what is sent](recipes/voices-and-providers.md): Voice lists at start (#24); Short lines, brackets and the Fish language hint (#23, #25); Azure Speech: configuration, the voice sheet, and word-level highlighting (#39); Sentence or paragraph requests (#61, `context-probe.ts`); Several sentences at once (#64, `download-concurrency.ts`).
- [Scrolling, flings and theme colours](recipes/scrolling-and-theme.md): A moved highlight leaves a strip behind (#35, `leading-strip.sh`); A chapter left unstyled by a fast fling (#34); A white page behind the dark reader: on opening, and in a long fling (#27); A fast scroll that jumps by whole chapters and shows an empty page (#58); A drawer's lines in the other theme's colour (#29, `line-colour.sh`); A live theme change with a drawer already open (#29, `live-theme-drawer.sh`).
- [The reading place and the page following it](recipes/place-and-following.md): Reading across the end of a downloaded chapter, and a place kept across a renumbering (#26, #45, #46); Play with the page scrolled away, and a place on a chapter heading (#50, #51); A Contents row while paused only moves the page (#52); The page follows the line being spoken (#71, `line-follow.cjs`); A real drag during a live glide (#71, `glide-touch.cjs`, `GlideTouchProbe.swift`); The Following mark, the way back, the collapsed lock, and Continuous (#71 batches 3/4, `FollowingProbe.swift`, `hx.cjs`, `continuous-follow.cjs`); The review fixes: a pause, a re-cue, a Block crossing (#71, `follow-fixes.cjs`).
- [Native audio queue (#63)](recipes/native-audio-queue.md): Native queue position versus actual rendered audio (#63); Output-driven audio/position prototype (#63, validation only); Production output-driven queue (#63).
