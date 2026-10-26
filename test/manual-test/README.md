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

## Purchase behavior follows the release role

Free and Debug copies have no purchase module or `store` harness command
(#324); Play and Downloads need no Trial/Unlock. Formal uses real StoreKit,
even in Xcode Debug configuration. Read [purchase/README.md](purchase/README.md)
before testing purchase behavior or switching roles; its current recipe
separates compiled-artifact, UI and genuine StoreKit evidence.

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
- [Metro and the bundle](pitfalls/metro.md): among them a Metro started with `CI=1`, which watches no file, so the app keeps its last good bundle (#317).
- [Simulators, installs and the simulator's volume](pitfalls/simulators.md): Simulators and installs; Away from the screen: the lock and the background time (#75); A fresh prebuild, and volume resets through an evening (#108–#110); A volume reset in a quiet stretch (#109 round 2); the volume back at 60 after an app relaunch with no boot (#146); the volume at 60 at the start of a session with nothing played (#148); another session's probe kills the shared app and wedges AXe while it runs (#305, 2026-10-20); a gap in the Debug Log that is the Mac asleep, and a copy of a Document that is the same Document (#307); a set undone within five minutes, caught by the check in front of the play (#307, 2026-10-20).
- [Locking the device, and the app away from the screen](pitfalls/lock-and-background.md): Home and Control Center through XCTest and `axe`; locking at a moment of a download; the lock probe's build directory shared by every session, and a Lock Screen Play the app refused, which the kit's `play` test still passes and which leaves the button on Pause (#148); a refusal that republishes the same paused state, which does not turn it back on beta12 (#148 round 2); the kit's `play` failing, and xcodebuild hanging in `simctl diagnose`, once beta13 puts the button back, and `play-refused` (#148 round 3); the centre button losing its identifier on iOS 26.5, where `play-refused` fails before the tap and the failed run again hangs in `simctl diagnose` (beta20, 2026-10-17).
- [Screenshots](pitfalls/screenshots.md): Screenshots of a sheet (including one shot before its slide-in begins, #103); Screenshots of the reading page; A system alert (#109); App Store screenshots on new simulators: the "09:41" clock, iPad windowing, iPhone drawers without Close, misread words (1.0.2).
- [Measuring inside the reader's WebView](pitfalls/webview.md).
- [Typing, environment and silence](pitfalls/typing-environment.md): a fresh simulator's first keyboard dismissal failing an XCTest the retry passes (#146); a relaunch replaying the last `store` command, the first `HX store` line printed before the products load, and a stray consent alert when Word Lookup is switched off with its consent (#148); the name-save reproduction's learned keyboard state and an early read after Create's dismissal (#318); `Back to editing`'s re-present latency, the hidden software keyboard under a connected Mac keyboard, and `simctl pbcopy` losing to the Mac pasteboard sync (#318, 2026-10-23).
- [Providers and audio](pitfalls/providers-and-audio.md): Route-loss probes, cached positions versus native freeze, LLDB's attach/continue artifacts, and a stale Fish voice-row predicate (#152); Native drift investigation (#63); Real touches on the player's head row, and Azure's own timing (#69, #70); Fish Audio from the simulator; Node probes against providers and books. Verifying #210/#209/#202/#205 (2026-10-18): axe-batch backspace drops, an AXe session dead for ten minutes mid-run and the boot that fixed it, and a lane held by a parallel session.
- [WebDAV and cross-device items](pitfalls/webdav.md): Talking to the owner's WebDAV host from the Mac; Crafting a cross-device item for #54/#55.
- [The shell](pitfalls/shell.md): `timeout` missing; zsh's `local a=$1 b=$a` (#148).
- [The simulator MCP servers](pitfalls/mcp.md): mobilebuildmcp's new names, its scheme and device defaults, installing expo-mcp; the share sheet's actions invisible to snapshot_ui/AXe, Cells to XCUITest, and synthetic taps it eats; axe's pixel coordinate space; the ~30 s automation-session wait after a boot (#95); one rendered line listed twice at one identical frame, and a lost touch-up freezing a screen transition (#103); a system alert is a `Sheet`, its Allow button answers a touch pair and not a quick tap, a masked field ignores `type_text` until revealed and focused, and a LogBox banner over Play (#109); a long text page's Copy callout, the back button's menu, and a momentum scroll (#111); `axe swipe` not moving a SwiftUI sheet where `axe drag` does, and a SwiftUI ColorPicker's well that only an XCTest tap opens (2026-10-01); a drag on a drawer's list scrolling it instead of moving the drawer, frames at 0.96 at the Drawer Height, a dark drawer's edge found only by its grabber, a list reopened where it was left after a Fast Refresh, iOS's own Look Up standing in for the app's lookup drawer while lookup is off, the page's selection callout eating a drawer's first drag, and `axe drag` not moving a WebView selection handle (#117); a virtualized Contents list with no off-screen rows for `scroll-touch`, a swipe that starts above a half-sheet closing it, and the Contents footnote eating the bottom rows' touches (#307, 2026-10-20); a row scrolled past the half-sheet's top edge touched on the reader behind it (#307 re-run, 2026-10-20); a slow `testmanagerd` on a new device and a time limit on every AXe call, typing into the phone's alert field, a Fast Refresh of the drawer, and the download probes' removed `Close Download` (#117 batch 2); a well's first XCTest tap opening nothing, a drag beside the opacity thumb, and a Fast Refresh cutting a well off from the app (#118); a Download ring that ignores `axe tap`, and copying the newest screenshot file saving the one before it (#146); a Download list's row under the header with an on-screen frame (#148); `axe drag --duration` taking seconds, so a 400 "ms" drag runs for 400 s (beta20, 2026-10-17); an AXe automation session dead for ten minutes mid-run on a session-created device, and a shutdown+boot through the shared lane restoring it in under a minute (beta6, 2026-10-18); a background `axe drag` not yet begun 1.4 s after it was sent, and a button's pressed fade read as movement (#312, 2026-10-21); AXe's edge-swipe preset and `axe swipe` not starting the phone's back swipe, where `axe drag` does (#317, 2026-10-23); an opening drawer's touch frames and a drawer that is no AX `Sheet`, and a kit script's stale `Add` label (#318, 2026-10-23).
- [Evaluating in the app through `cdp.cjs`](pitfalls/cdp.md): `breakfetch` without `"from"` refusing nothing (`NaN`), and a shared Model list hiding a later refusal (beta20, 2026-10-17).
- [A download away from the screen](pitfalls/background-downloads.md): the simulator's bounded background time; the continued processing task's log lines (#75, #76, #77); polling every preparation, the lock's flicker and the continued task, a hotspot's `waiting`; a dead host VPN holding a download in `waiting`, and a reboot that resumes it unattended (#146).
- [Merges, seeding and past verification runs](pitfalls/verification-runs.md): Verifying #136: a `build_sim` transport timeout, and a simulator re-adopting a stale data container (2026-10-07); Verifying #134: a chapter downloaded again from memory after a deletion, and a moved `, being read` suffix (2026-10-05); Verifying #115: Play in the middle of the transport row (2026-10-01); Merging main's #67 and #68 into #71 (2026-09-26); Verifying #71 batch 2; Seeding a real book's place through the harness (#68); Independent verification of the collapsed player and its edge swipe (#67); Verifying #71 batches 3 and 4 (2026-09-26); Verifying #75: a download beside a Reading (2026-09-28); A leftover `harness.json` replays its last `add` at every relaunch and resurrects a moved-away file (#95).

### Verifying #311, the window across a Download's chapters (1.0.0 (12)-beta1-debug) (2026-10-21)

Record: `notes/NOTES_2026-10-21.md`; new kit scripts `downloads/download-window-sampler.cjs` (samples `state`/`writing`/`current`/`occupied` through one CDP connection) and `downloads/download-run-metrics.cjs` (clip metrics from birth times + the sampler), new probe `settings/SentencesAtOnceProbe.swift`.

- **A same-process re-download after `deleteDownloaded` completes from the app's in-memory clip cache (#134 again), and now it also silently re-writes the chapter files.** Symptom: `download-chapter.cjs` reads `done` in 3 s with bytes matching the previous run; the fake's or Fish's log gains no requests. Cause: the runtime's clip cache survives a deletion. Fix, stricter than #134's: after deleting, terminate and relaunch the app before the next download, and confirm the clip directory is empty and the provider log gains requests — `occupied: 0` is only the catalogue.
- **`deleteDownloaded` is a silent no-op until the document's plan is loaded, and `occupied` reads a lazily loaded inventory.** Symptom: a CDP delete "succeeds", `occupied` reads 0, and the next download re-saves everything from cache. Cause: `deleteDownloaded` returns early while `planOf` is null, and `occupied` sums an inventory only `requestInventory` fills. Fix: open the Download drawer (or `requestPlan`) and `requestInventory` before deleting, and verify the deletion by the clip directory, not by `occupied`.
- **`deleteDownloaded`'s file deletion is asynchronous: the rows hide at once, a background sweep deletes the files and drops the rows.** Symptom: after a deletion, terminating the app quickly leaves the clip files on disk with `occupied` 0; and a sweep resuming at the next launch can delete files a continuing download has *re-saved* under the same keys — the catalogue then reads clips `ready` whose files are gone (measured 16:08–16:15: `occupied` 251,540, directory empty). Fix: never delete and terminate in the same breath; wait for the directory to empty before killing the app. The second half is an app race as well, not only the harness's: `cleanDeletions` removes the files of the `deleting` rows it listed even when a `saveClip` of the same key has meanwhile rewritten the file and made its row `ready` (`notes/NOTES_2026-10-21.md`, 14:22 entry); open as #313.
- **`download-lock-at.cjs`'s `preparing` trigger does not fire under #311.** The task now reads `preparing` only while nothing is out (about a second, once, for an already-prepared plan) while the next chapter is prepared ahead under `downloading`, so the lock never lands and the script samples to `done` (`logs/lock-d5.log`). Also: the script's bare `enqueue` needs the plan to exist — after `removeDownloads` (which wipes the plan) it leaves the task `blocked` for ever. Away-from-screen checks need a new staging that arms on `preparationRequest()` for a known-unprepared chapter.
- **A native SwiftUI `Menu` row (Settings › Providers › Sentences at once) does not open from AXe touches, with or without a delay; an XCTest tap opens it.** `settings/SentencesAtOnceProbe.swift` is the working pattern, and when attaching to an *already running* app the probe must build `XCUIApplication(bundleIdentifier: "top.xujialiu.openreader")` — a bare `XCUIApplication()` fails with "No target application path specified".
- **`ax.py tree` reads take 5–10 s; inside a timed UI window they are the delay.** Two ring taps landed after their boundary closed because a tree read sat between arming and touching. Fix: touch at known coordinates first, read the tree afterwards.
- **Fish served a byte-identical re-download of the same texts in ~3 s once in a day of runs (184 requests at 5 at once).** Provider-side caching for identical text+voice exists; when a timed repeat comes back impossibly fast with the previous run's exact byte total, treat it as cache-served and rerun rather than recording it.
- **A leftover harness command is not always consumed: an `add` replays at every relaunch and a `voice` command only runs when a reader is mounted.** Symptom: `[hx] added …` at every launch; a voice patch silently pending. Fix: after staging, overwrite `harness.json` with a no-op (`{"seq":N+1,"do":"noop"}`) unless the pending command is wanted.

### Verifying #237/#280/#279 (1.0.0 (12)-beta5-debug) (2026-10-21)

Session-created `iPhone 17 fix1` (iOS 26.5, `A9934541-5D22-4ACE-BA9F-7189B68973D7`), Debug build from the tree (guarded prebuild + `xcodebuild RCT_METRO_PORT=8091`), Metro 8091 from the same worktree, `provider-fault-server.cjs` on 127.0.0.1:8791, provider configured through the harness settings patch, Consent answered once after the alert was checked. Scenarios per [provider-response-failures.md](voices-and-providers/provider-response-failures.md), "A passing 5xx".

- **A retried synthesis's note never reaches the Debug Log, so grepping the log for "retries" finds nothing while the retries demonstrably happened.** `clipFacts` (`src/offline/runtime.ts`) prints only audio and word timings; `result.note` (" after 2 retries of HTTP 503, 503") is carried by the SynthesisResult and the unit tests, but by no log line. Symptom: the fault server's `/__speech` shows the three requests and `[provider] … -> 503 -> 503 -> 200` is in the log, yet the ADR 0084 note is nowhere. Count retries on `/__speech` and the `[provider]` status lines until `clipFacts` includes the note.
- **Diff `/__speech` by position from a snapshot taken immediately before the scenario, never an older one.** A `before` snapshot from minutes earlier folds older runs into the diff, and the same text re-requested under a new fixture voice appends entries under the SAME hash (the server journals by text, not voice), so a naive per-text grouping shows entries from two scenarios with impossible-looking gaps.
- **A harness `{"do":"play"}` then `{"do":"pause"}` written ~450 ms apart lands the pause inside the retry's first pause window** (the app polls harness.json four times a second), which is how the mid-pause abort is measured without an XCTest. Compare the journal's `at` stamps with the Debug Log's `[reading] pause at utterance` line to decide which requests came after the pause.

### Verifying #276/#252/#235 (1.0.0 (12)-beta6-debug) (2026-10-22)

Session-created `iPhone 17 b6test` (iOS 26.5, `A558280D-78F5-427A-8F4B-A74B2828B765`), guarded prebuild + `xcodebuild RCT_METRO_PORT=8091` from the `ios-tester` worktree, `provider-fault-server.cjs` on 8791, three fixture Documents (`short-test`, `boundary`, `pause-order`). Record in [voices-and-providers/provider-response-failures.md](voices-and-providers/provider-response-failures.md), "No audio, an undecodable reply, and a cancelled Voice choice".

- **A paused seek prefetches the seeked sentence's speech: one extra request for that text lands on the journal before any Play.** Symptom: a scenario's journal diff shows one request timestamped between the seek and the Play, then the Play's own. Cause: the reader fetches the paused Utterance's Clip so the place is ready. Fix: snapshot `/__speech` after the seek and expect the doubled first request; and remember the prefetch is held by `delayVoice` too — a `delayVoice` hold can be largely consumed by the seek's prefetch before Play happens, so derive a hold window from the seek's stamps, not the Play's (this is how a #252 choreography missed its window).
- **A fault-injected Clip that was cached as encoded bytes stays poisoned for that voice+text, by design (#276: Play asks the cache, decodes, fails, stops again).** Symptom: a later Reading of the same fixture in that voice ends oddly at the poisoned sentence. Fix: keep one voice per fault shape (`empty-*`/`bad-mp3` on different fixture voices) and never play through a poisoned region; switch fixtures or voices between scenarios instead of purging caches.
- **A Voice switch in a fault run plays the rest from the other Voice's cache, so a poisoned Clip in the first Voice is passed by, not reached.** Symptom: a run with a `bad-mp3` Clip cached for one Voice at the last Utterance ends on "That was the last of this document…" with no error note and no request for the last Utterance. Cause: the run also switched Voice; the switch landed, `failed` was cleared with it, and the other Voice's good cached Clip was heard (2026-10-21 23:57, `fixture-breeze` to `fixture-alto`). Fix: keep a fault run to one Voice, or poison the Clip in the Voice the Reading ends in; read the settings Voice in the harness status before and after.
- **The #252 exact window — cancelling while the replacement's first Clip is queued on an empty queue — is one native clock tick, not the ~1 s a choreography assumes.** Measured: a switch armed on an empty queue landed (selection published, `voice=` flipped) before a re-choice ~0.4–0.7 s later, turning the re-choice into a plain new switch. A 250 ms harness poll or human drawer taps cannot land inside it; leave the exact race host-tested and verify the observable contract (reading goes on in the current Voice, no lasting spinner) instead.
- **A Voice choice made while the queue is dry and the current Voice's fetches are still out starts no fetches for the new Voice until those settle** (~1.3–1.6 s; the journal shows the new Voice's requests stamped with the next settle, together with the read-ahead's next window). Unchanged code, not a #252 claim; visible only under `delayVoice`. If chased, read the Reading's `status.pendingVoice` off the Player fiber through CDP (the `kit/reading.cjs` walk pattern) — and note the pitfall below first.
- **A one-off CDP probe saved outside the repository cannot `require('ws')`** — resolution follows the script's own path, and `/tmp` has no node_modules. Fix: require it by absolute path from the worktree's `node_modules` (as `kit/reading.cjs` gets for free by living in the kit).

### Verifying #310 (1.0.0 (9)-beta21, an upload pair's even number) (2026-10-21)

Recipe: [`settings/version-line.md`](settings/version-line.md). Session-created `iPhone 17 upload-pair` (iOS 27.0, 24A434, `4762A998-9166-45D6-B668-129C6961D83D`) for the sub-worktree `.worktrees/upload-pair`, a Debug app built from that tree (guarded boot + `prebuild` phase 81 s, guarded `xcodebuild` + install phase 154 s), its own Metro on 8271. No audio was played.

- **"Copy a Debug app from another simulator" had no source: this Mac had no iPhone simulator at all, and the one Debug `.app` on disk was too old.** Symptom: `xcrun simctl list devices` listed three pristine iPads per runtime (18 MB of data each) and nothing booted; `find ~/Library/Developer/Xcode/DerivedData -name OpenReader.app` found only `OpenReader-bkey…/Build/Products/Debug-iphonesimulator/` from 2026-10-07 13:26 (`CFBundleVersion` 6, `DTPlatformBuild` 24A430, built at about 7af3a4c, #136) and `/tmp/openreader-simulator-build` did not exist. That product has no `OpenReaderStore` module (`strings -a OpenReader.debug.dylib | grep -c OpenReaderStore` read 0, against 5 in the fresh build) and none of the native changes since (`git diff --stat 7af3a4c HEAD -- modules plugins patches package.json app.config.ts`: 18 files), so installing it would only have produced `Cannot find native module`. Fix: build from the tree, as `docs/install-on-simulator.md` says, plus `RCT_METRO_PORT` and `-jobs 6` (next bullet): `npx expo prebuild --platform ios` (52 s with the CocoaPods cache warm), then `xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader -configuration Debug -sdk iphonesimulator -destination id=UDID -derivedDataPath DIR ENABLE_USER_SCRIPT_SANDBOXING=NO RCT_METRO_PORT=PORT -jobs 6 build` (148 s, `BUILD SUCCEEDED`), then `simctl install`. Neither fix of the #106/#108–#110 fresh-prebuild failures was needed: `nm -gU ios/Pods/React-Core-prebuilt/React.xcframework/ios-arm64_x86_64-simulator/React.framework/React | grep -c Sealable` read 13 straight after `pod install`, though `.last_build_configuration` did not exist. Before trusting a copy, read its `CFBundleVersion` and mtime against `git log`, and the module you need in the `.debug.dylib`.
- **`RCT_METRO_PORT=PORT` on that `xcodebuild` lets a launch with no launch argument find this tree's Metro, an XCTest probe's own `app.terminate(); app.launch()` included.** The generated `Info.plist` holds `RCTMetroPort` as `$(RCT_METRO_PORT)`, which is empty unless the build setting is given; with a port in it, Expo's `adoptInfoPlistMetroPort()` (Debug) writes `localhost:PORT` into `RCT_jsLocation` at each launch. `SettingsVersionProbe` relaunched the app with no launch argument, its second `[launch]` line followed 4 s later, and Metro 8271 (the only Metro on the machine) logged `iOS Bundled 51ms index.ts (1 module)` for it: no container-plist edit, no `cfprefsd` shutdown+boot, no re-signed copy ([metro.md](pitfalls/metro.md)). `plutil -p …/OpenReader.app/Info.plist | grep RCTMetroPort` shows the port a build was made for. That route is only open when you build; a copied app still needs the re-signed `Info.plist` or the launch argument.
- **A fresh iOS 27.0 device's first boot spends about two minutes in a daemon storm, and the 1-minute load average keeps reporting it long after it ended.** `bootstatus -b` answered in 25 s (10:53:14), then `top` read 0 % idle with the load average at 75, 114, 156 and 193 over the next minute (`diskimagesiod`, `mds`, `WindowServer`, the device's own `addressbooksyncd`, `healthappd`, `sirittsd` …), the figure that wedged CoreSimulator for the #303/#304 r2 device. Here it settled without a wedge: a `prebuild` started inside it still finished, and `simctl io screenshot` answered at once. At 10:54:46 `top -l 2` read 32 % idle (load average 147); at 10:55:21 it read 85 % idle while `vm.loadavg` still read 84. Decide that the storm is over from the second sample of `top -l 2`'s idle percentage, not from the load average, before starting a build; here that was about two minutes after the boot.
- **`ls DIR/debug-log-*.txt` straight after a launch that cleared the Debug Log is a zsh error, not an empty folder.** `zsh: no matches found: …/debug-log-*.txt`: the clearing launch removes the old files, and the writer creates `debug-log-000001.txt` only at its first flush (the launch line stamped 11:01:27.839 was on disk by 11:01:35). Poll with `find "$D" -name 'debug-log-*.txt' | grep -q .`, not with a glob.
- **The `cleared the Debug Log of <version>` end of the launch line needs a staged `version.txt` on a fresh container.** A new device holds no log of another version, so the launch line has no suffix (the natural runs read `…, kept in file:///…/debug-log/` and nothing after it). Terminate the app, `printf '1.0.0 (9)-beta20' > "$DATA/Library/Application Support/debug-log/version.txt"` (no newline, as the app writes it), and relaunch with `-RCT_jsLocation`: the new line ended `; cleared the Debug Log of 1.0.0 (9)-beta20: 1 file, 0.0 MB` and `version.txt` read `1.0.0 (10)-beta21` again. Say in the report that this branch was staged.
- **`sim_volume` was back at 60 three and a half minutes after a `set`, with nothing played** (the rule of [pitfalls/simulators.md](pitfalls/simulators.md) again). `silence.sh set` read 0 at 11:01:24, just before the app's launch; the final `check` at 11:05:01 read 60, and `audiosettings.plist`'s mtime dated the rewrite to 11:04:36 (`sim_output_device_uid` `BuiltInSpeakerDevice`, no boot). Nothing was played, so nothing sounded; the device was set to 0 again at 11:05:12 for the hand-over. Date such a reset from the plist's mtime (`stat -f '%Sm' -t '%H:%M:%S' …/simulatoraudio/audiosettings.plist`), and never take a hand-over's zero as still standing.

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

### Verifying #249/#250/#282/#283 (1.0.0 (9)-beta19) (2026-10-20)

Record: [`sync/positions-late-adoption-and-copies.md`](sync/positions-late-adoption-and-copies.md). Session-owned iOS 26.5 device (`iPhone 17 pos19`), Metro from the parent worktree on 8088, Debug build 9 from a guarded `xcodebuild` phase, `delaying-webdav.cjs 8723 4000` and `fake-kokoro.cjs 8891` as the controlled services, real touches on Play for the two #249 runs.

- **An EPUB without `META-INF/container.xml` does not fail — it lays out for ever.** A fixture generator that forgot the entry produced a Library row that opened onto "Laying the document out…" indefinitely: no `[renderer]` line, no blocks, no error, and the harness/status lines kept ticking, so nothing looked broken but nothing could be measured. Check the generated book's zip listing (`META-INF/container.xml` first) when a reader sticks at that line.
- **A per-book file list passed as one tuple ships one spine item.** `book(t, i, [['one','two']], …)` is one 3-wide tuple, so the OPF declared a single chapter: the Contents rows pointed at undeclared hrefs, `renderAhead` said "there is no section after it", and playing past the last loaded sentence ended the Reading as "ran out of text". Count the spine in the generated OPF, not the files in the zip.
- **A harness `play` does nothing silently while the app has no Voice.** With `settings.voice` empty, `start()` refuses with no note at handler level (`[reading] play at utterance none, compatible ` — a trailing space where the voice would be), and no Voice sheet opens to say so; only the button press opens it. Since #327 (ADR 0089) there is one Voice, `AppSettings.voice`, so one `{"do":"voice",…}`, or a `settings` patch that sets `voice` with an enabled `provider`, serves every Document. Before it each fresh Document needed its own `{"do":"voice",…}`, because the reading host substituted the Document's own Voice (ADR 0010).
- **`online` in the offline runtime stays false if a launch lands in a connectivity event.** A fresh device launched during such an event logged `[sync] network path unavailable`, and synthesis then failed `No network connection` for ever after (the module only updates on the next event), while sync itself worked — its transport re-checks. `reading.cjs state` says nothing; the fake TTS receiving no request while the status shows a cue is the symptom. An app restart re-reads the state and clears it.
- **`play-for`'s budget must include the 2 s pre-Play sync wait and the rate.** Against the delaying server the Player's wait always runs the full 2 s, and at the default 1.50× a 2.5 s fake clip is 1.67 s of wall time: `play-for 2` paused before `start()` ran (no `play.request`, nothing written), and `play-for 4` on a 2.5-sentence block landed on the sentence *after* the seeked one. Budget press + 2 s + (clip ÷ rate), and pause inside the wanted sentence's clip.
- **A paused seek before the replay loses the #249 stamp race.** The choreography needs the desktop item to beat the entry, but a seek to the replay target makes the replay's cue a *new* place whose fresh Stamp (written 2 s after the press) outranks a desktop item crafted earlier — `play: ok … 0 places taken`, and the unmount then correctly writes the phone's place. The working order: leave the reader paused on the stored sentence, PUT the desktop item (Stamp newer than the place this Reading wrote since its last pause) while it sits there, then press Play — the replay cue then matches the stored place and writes nothing, and the held GET delivers the adoption mid-clip.
- **A reopen-only replay is not a #249 regression check.** A freshly mounted Reading starts with `reachedRef.toWrite = null` and no writeback for the unmount to retire, so the old code passes it too; the desktop place standing after a reopen-only replay+switch is a no-earlier-progress control. The regression needs prior genuinely new progress in the same mounted Reading — play to a different sentence and pause there first — and the switch must land inside the replayed clip's REMAINING time: the replay resumes at the paused mid-clip position, so a pause deep in a 12 s clip leaves only ~4.6 s after the 4 s adoption window, and a late switch lands just after the next sentence's cue (measured: `received=speak utterance=5` 68 ms before the close). Longer clips and an early pause widen the window.

### Verifying #240/#245/#241/#242 (1.0.0 (9)-beta18) (2026-10-20)

Record: [`downloads/sentence-boundaries-batch.md`](downloads/sentence-boundaries-batch.md). Session-owned iOS 26.5 device (`iPhone 17 seg18`), two Metros (batch 8095, pre-batch baseline 8096 from a detached `f12eefc` worktree with `npm ci --ignore-scripts` for unpatched sentencex), the kit's fake Kokoro on 8812, `fixtures/segmentation-fixture.ts`.

- **The Library's action/Download sheets float at the app's root, so they cover the Reader and survive route changes.** A touch aimed at the reader's `Choose a Voice` landed on the still-mounted seg-en-negs Download drawer; the drawer remained through harness `open` (the Reader pushed on top of it) and through `shut` (goBack pops routes, not the sheet). Fix: close sheets through their own `Back from …` button or a grabber drag **before** navigating, and confirm by screenshot — the AX tree lists the covered sheet's rows and the Reader's rows together, so a tree alone does not say what a point touch will hit.
- **`ax.py touch LABEL` uses the frame from its own earlier tree read; Library rows scroll when a sheet closes and the touch lands on a different row's button.** Twice `Actions for seg-en-negs` opened the seg-ja sheet (and once the reverse). Fix: re-read the tree immediately before each touch, touch, then verify the sheet's own heading (`Heading | seg-…`) before touching anything inside it.
- **`cdp.cjs --eval` takes the path of a file holding one expression; an inline expression string is read as a filename** (`ENOENT … open '(() => …'`). The other kit scripts (`download-chapter.cjs`, `walk-utts.cjs`) write temp files for the same reason.
- **`fake-kokoro-two-voices.cjs` refuses nothing unless it was started with `OPENREADER_FAKE_TTS_REFUSE=<control file>`.** The env var names the file; it is read per request, so it can be rewritten mid-run — but `refuseFrom` compares against the process's own served counter, which resets at restart. And a refused chapter ends the task `done` with `failed:[chapter]` — the migration pauses only `state !== 'done'` tasks, so a genuinely unfinished/paused legacy download must be staged by slowing the fake (`OPENREADER_FAKE_TTS_DELAY_MS`) and pausing it mid-flight (`toggleTask` over CDP), not by refusing a request.
- **`debug-log.py`'s CoreDevice listing answered `no Debug Log … is the installed build one with Debug Mode?` while the log existed** at the container's `Library/Application Support/debug-log/debug-log-000001.txt` — copy that path directly (the file also names its own location in its `[launch]` line). The same launch line is the cleanest JS-switch provenance: the beta18 launch logs `cleared the Debug Log of 1.0.0 (9)-beta17`.
- **A readiness check run seconds after `simctl launch` fails on its own timing, not the environment.** The first `ios_ready.py --metro` ran 2 s after launch and found no CDP target while Metro was still bundling (14.9 s cold); the immediate recheck passed with no recovery spent. Wait for the bundle (Metro log's `iOS Bundled …`) before the first readiness check.

- **`reading.cjs state` reports `Reading handler evaluation failed` on the Library with no held Reading.** The helper requires a mounted `Player` and otherwise throws `Open a Document first`; its outer error hides that message. During the sentence-boundary batch's final parent check, the app correctly had no Reading after returning to the Library. A read-only CDP fiber check found the Reading context's `current=null`, zero Players and the expected beta18 version, proving the precondition rather than a playback failure. Use the held Reading context for this delivery check; do not start speech just to make the Player helper work.

### Verifying #327, one Voice for every Document (1.0.2 (18)-beta4-debug) (2026-10-26)

Session-created `iPhone 17 voice327` (iOS 26.5, `6FC2EC87-5D0C-49D1-939B-FE4AFD54DD02`), Debug app from a guarded `prebuild` + `xcodebuild RCT_METRO_PORT=8327` of the tree (derived data `/tmp/openreader-327-01/dd`), Metro 8327 from the worktree, `fake-kokoro-two-voices.cjs` on 127.0.0.1:8896 (1 s clips, 1.5 s answer delay), fixtures Boundary/Short Test/Pause Gap, Consent answered for `127.0.0.1:8896` after the alert was read.

- **The Download drawer's "Use downloaded voice · X" row vanishes once X *is* the one Voice, so a rerun of a handover test finds no row.** Twice a rerun chain died on `no element 'Use downloaded voice · …'` because the previous tap had already made that voice the one Voice (17:05, 17:18). The row lists a Document's saved Voices *other than* the current one. Fix: between runs, stage the previous Voice back (Voice drawer, or the harness settings patch when the provider is disabled) and read the drawer's rows before the timed tap.
- **A held Reading's playback window loses to UI-chain latency: label-touch chains that include `ax.py tree` reads ran 20–52 s from Play to the drawer tap, and a 10-Utterance fixture ended itself mid-chain twice** (end notes at 17:00:20 and 17:02:58, before the tap), turning a handover test into a stopped-reading test. Fix: patch `rate` down (0.5 halves the speed), drop every mid-chain tree read (`ax.py touch` re-reads the tree itself and fails loudly on a missing label), and prove "playing at tap time" afterwards from the frozen place and the absent end note, not by assumption.
- **A blind coordinate chain whose first touch changes the screen mis-aims everything after it.** Chained raw `axe touch` frames aimed at the reader's Library button, a Library row's actions and the actions sheet's Download row opened **Settings › Providers** instead (17:05–17:08) when the first touch landed on a different screen than assumed — (38,84) is the reader's Library button *and* the Library screen's Settings button. Fix: in any chain whose first step can change screens, use exact-label touches (`ax.py touch LABEL`), which are self-verifying; reserve coordinate touches for timed windows whose screens were verified in the same state.
- **With the Voice's Provider disabled, the Voice drawer lists no voices at all** — only "Enable a provider in Settings to choose a voice." — so a test cannot switch the one Voice through the drawer in that state; stage it with the harness settings patch (`{"do":"settings","patch":{"voice":"…"}}`).
- **A Reading stopped for a disabled Provider names #103's "No provider is enabled. Enable one in Settings to listen." unless the engine was built after the enablement change.** At 17:24:19 that sentence was right: `enabledProviders` was `[]`. Patched to `['local']` at 17:26:21 while the reader stayed mounted, the next Play reused the engine built before the patch, and the stop at the first unsaved sentence still said "No provider is enabled…" (17:26:46); after a relaunch the same stop said "OpenAI Compatible is disabled. Choose an enabled provider." (17:36:33). The engine's `offlineProvider` closure captures settings at build time and `enabledProviders` is no rebuild trigger. The stop point and the muting are correct either way; the sentence can lag the enablement state until a rebuild. Pre-#327 shape (#103's engine capture), not a #327 regression — but relaunch before asserting *which* sentence a disabled-Provider stop shows.
- **`reading.cjs state` fails for a held Reading seen from the Library** ("Reading handler evaluation failed"), not only for the no-held-Reading case #240 recorded: the parked Player is not reachable by its fiber walk from the Library route. Use the Debug Log (`[reading]` lines), the fake server's request log, and the Library row's "Last read: …" place for held-reading evidence.
- The engine's stop at the first unsaved sentence lets already-queued audio finish first: the Player note and `[reading] note:` line land while the last saved clips are still audible (playing=true lines for ~8 s past the note at 17:26:46–54), and `playing=false` settles a few seconds later at the unsaved utterance. Budget the wait before reading the note as final.

### Verifying #329, Switch voice in place of the saved-Voice rows (1.0.2 (18)-beta5-debug) (2026-10-27)

Session-created `iPhone 17 v329` (iOS 26.5, `95121F63-CFFF-435A-B16D-08329D4EBDA6`), Debug app from a guarded `prebuild` + `xcodebuild RCT_METRO_PORT=8329` of the tree (18fc257, derived data `/tmp/openreader-329-01/dd`), Metro 8329 from the worktree, `fake-kokoro-two-voices.cjs` on 127.0.0.1:8961 and `at-sign-fake-openai.cjs` on 127.0.0.1:8962 (1 s clips), fixtures Pause Order/A Short Test/Pause Gap, Consent answered for both fake addresses after each alert was read. Probe: `downloads/SwitchVoice329Probe.swift` (env-driven; opens the menu and chooses with XCTest taps). No audio was played.

- **xcodebuild forwards the caller's environment to the test runner only with the `TEST_RUNNER_` prefix, and an env-driven probe then silently runs its env-free half.** Symptom: `SV_EXPECT_ENTRIES=… bash run-probe.sh …` "passed" in 3 s having never opened the menu — every `env["SV_…"]` read nil. Fix: read the vars through the prefix (`env["TEST_RUNNER_SV_…"]`, SleepMenuProbe's `TEST_RUNNER_SLEEP_ITEM`), and in the raw `test.log` check the taps you believe in (`Tap "Switch voice" … Button`) before trusting a pass.
- **After editing a probe, the next `run-probe.sh` invocation can execute the previous build's binary.** Symptom: a run failed citing a line number from before the edit, in 1.6 s, with none of the new staging taps in `test.log` — while the invoked env clearly set the new flags. Cause: the incremental `build-for-testing` skipped the changed source once (the following run rebuilt it). Fix: after any probe edit, read the run's first `Tap`/`Terminate` lines against the current source before reading its verdict; a mismatch voids the run. The #329 doc2 absence "failure" was exactly this, and its rerun with a verified trace passed.
- **Downloads ask the same Consent question Plays does, and until it is answered the task sits `downloading` with `writing:[chapter]` and the Provider log gains nothing.** `runtime.ts`'s `synthesize` runs `consent.ensure` before anything is built or sent, so a CDP-staged download stalls exactly like a held Play, with the alert up over wherever the app happens to be. Fix: `ax.py alert` after staging a first download at a new address, check the recipient, `ax.py alert-touch Allow`; the fake's log then grows at once. Both of this run's fake addresses (8961, 8962) asked separately.
- **`cdp.cjs` disconnects 1006 when `OPENREADER_METRO` is a `localhost:` URL, even though the script rewrites the origin to match the debugger endpoint; `http://127.0.0.1:PORT` works.** (The comment in `cdp.cjs` says the mixing is the problem — this run shows the metro URL itself must be 127.0.0.1.)
- **AXe's tree repeatedly came back empty (the app node with no children) after `simctl terminate` + `launch` cycles, while XCTest probes kept working throughout.** One `shutdown`+`boot` through the shared lane restored it (first read after the boot still empty; ~45 s later fine), but it emptied again on the next relaunches. Fix: after a relaunch, drive staging from an XCTest probe (this run's `SV_STAGE` opens Library row → More actions → Download inside the probe) and keep `ax.py` for reads, retrying over a minute; do not spend the recovery twice.
- **The Voice line and the menu entries take their label text from different sources, so assertions must expect each form.** On Manage, the line reads the managed record's bare label (`Voice · af_bella`); on Download it is `knownVoice(settings)?.label` when the catalog holds the voice (`Voice · Nova (fake)`, the Provider's own name) and only falls back to `Voice · Kokoro FastAPI · af_nova` when it does not. Two of this run's probe "failures" were wrong expected strings of exactly this kind; the raw lines in the failures are the evidence the taps landed.
- **The simulator's volume reset to 60 again with nothing played** (the #148 recurrence), caught by `silence.sh check` in the same breath as the first probe run; `set && check && probe` in one chain from then on.

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
- [The collapsed player and the held Reading](player-and-reading-held/README.md): The collapsed player, the navigation bar and the Reading Button (#67); The Reading held in the Library (#68); The Reading held on a real, long book (#68); Disabling the active Provider while a Reading is held (#68, handler probe); A real collapse and reopen during live playback (#71, `player-touch.sh`); A tap, the Skips and a Contents row while playing, with no wait (#86, `Tap86Probe`); A drag on the open Player moves nothing (#312, `player-drag.py`).
- [Scrolling, flings and theme colours](scrolling-and-theme/README.md): A moved highlight leaves a strip behind (#35, `leading-strip.sh`); A chapter left unstyled by a fast fling (#34); A white page behind the dark reader: on opening, and in a long fling (#27); A fast scroll that jumps by whole chapters and shows an empty page (#58); A drawer's lines in the other theme's colour (#29, `line-colour.sh`); A live theme change with a drawer already open (#29, `live-theme-drawer.sh`).
- [The lock screen and the playback icon](lock-screen/README.md): Lock-screen screenshot and button inspection; The lock screen's playing state on a physical iPhone; Inspect the simulator's playback icon resource.
- [Sync](sync/README.md): Sync: the Sync screen, the switch, and places crossing devices (#20).
- [Native audio queue (#63)](native-audio/README.md): Native queue position versus actual rendered audio (#63); Output-driven audio/position prototype (#63, validation only); Production output-driven queue (#63).
- [Purchase and release copies](purchase/README.md): the formal/free/Debug artifact and UI matrix (#324), formal StoreKit testing, source/cache handoff, and separately labelled historical Trial/harness records.
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

### Verifying #314/#315, an "@" in a typed Address's password (1.0.0 (12)-beta4-debug) (2026-10-21)

Session-created `iPhone 17 u314` (iOS 26.5, UDID `1573367A-EB25-42CA-8147-FBC423736D91`), a Debug app built from the working tree (`expo prebuild` + a guarded `xcodebuild` with `RCT_METRO_PORT=8314`), Metro 8314 from the worktree, and the new kit server `voices-and-providers/at-sign-fake-openai.cjs` on 8915. No audible playback (simulator volume 0 at every play).

- **A Play whose Provider setup is incomplete never reaches Consent, logs no `[reading] play` line, and shows no alert — only the note under the player.** Symptom: `ax.py touch Play` reported a touch at the button's own centre, the status stayed `playing=false utterance=null`, `ax.py alert` read `NO ALERT`, and the Debug Log gained no `[reading]` line; it reads exactly like a lost touch. Cause: the harness `settings` patch REPLACES the whole `compatible` object, and this run's first patch carried `"model":""` — the play refuses at once with the note `OpenAI Compatible needs a model.` before the play is logged or Consent can ask. Fix: read the player's note line (tree or screenshot) before concluding a touch was lost, and stage `compatible` with a model, as `voices-and-providers/consent.md`'s recipe does (`"model":"fake-tts"`).
- **`fake-kokoro.cjs` cannot evidence the warm-up `GET /`: it answers every non-`/v1` path 404, and its 404 line logs no `auth=`.** The #315 warm-up claim ("the GET carries no Authorization header and no user name") needs that field on the very line the GET produces. Fix: `voices-and-providers/at-sign-fake-openai.cjs` — every request is one line `<ISO> <METHOD> <path> -> <status> auth=<present|absent> basic-user=<name|->`, `GET /` answers 200, a synthesis keeps fake-kokoro's counted line shape, and the Basic password is never logged (presence and user name only).
- **`nohup CMD … &`'s `$!` is the wrapping shell's PID, not the service's.** Both of this run's services started that way: Metro's listener was node 14264 under shell 14237, and the fake server's node 30798 under shell 30795 — killing `$!` released nothing and the port stayed LISTENing. Fix: record the listening PID from `lsof -nP -iTCP:PORT -sTCP:LISTEN` at start, kill that PID, and confirm the port is free before reporting a release.

### Verifying #316, the old unscoped Unlock (1.0.1 (12)-beta7-debug) (2026-10-23)

Record: [`purchase/beta7-unscoped-unlock.md`](purchase/beta7-unscoped-unlock.md); new kit script `purchase/plant-record.sh` (plants, shows or removes the container's `purchase.json`, refusing while the app runs). Session-created `iPhone 17 purchase316` (iOS 27.0, `BBA6B4B7-AD14-4E66-8720-C819BFCD52AF`), Debug app from a guarded `prebuild` + `xcodebuild` of the tree, Metro 8081 from this checkout, the kit's fake Kokoro on 8895.

- **A foreground-refresh check passed vacuously after `axe button home`, which `pitfalls/lock-and-background.md` already says does nothing on iOS 27.0 (met again).** Symptom: ten seconds of status lines stayed `app=active`, no new `[purchase] owned:` line appeared, and the next `simctl launch` "foregrounded" an app that had never left. Cause: the Home press was ignored. Fix: `simctl launch com.apple.Preferences`, then `simctl launch top.xujialiu.openreader`, and credit the foreground entry only after the Debug Log's own `app=` field went `inactive` (10:54:15) and `background` (10:54:20). With a null source the refresh's mark is a new `[purchase] owned: …` line (10:54:23.422): `keep()` re-logs it on every refresh because `sameSource(null, null)` is false, so the line is also a marker that a refresh ran.
- **Reading the Debug Log 1.5 s after a harness command showed the previous answer (`FLUSH_MS` is 2,000; documented, here measured).** The app picks a command up within 0.1 to 0.2 s and stamps the answer at once, but the line reached the file 2.04, 2.04, 2.07 and 2.09 s after its stamp (four samples, `{"do":"store"}`). Read 3 s after writing, or poll the file for the new line.
- **`timeout` is missing (`pitfalls/shell.md`); `perl -e 'alarm shift @ARGV; exec @ARGV or die' SECONDS CMD …` stands in for it.** Tested: with `2 sleep 6` it exits 142 (SIGALRM) after 2 s, with `5 true` it exits 0. The phase scripts bounded `simctl boot`, `bootstatus` and `prebuild` with it.
- **The simulator's volume was back at 60 within 3.5 minutes of a `set`, with nothing played (the documented reset, here observed with the output device named).** The `set` was 10:42:55 (inside the guarded phase, before the build); the first `check` at 10:46:24 read 60, and `audiosettings.plist`'s mtime then read 10:46:29, so the file was rewritten again after that check and its mtime cannot date the first reset. `sim_output_device_uid` was a Bluetooth output (`10-B5-88-88-71-A9:output`). The `check && simctl launch` chain refused and launched nothing; `set && check && launch` in one chain at 10:46:30 passed, and every later launch and Play was chained that way.
- **The `ios/` of an earlier session is stale after a Version bump.** `plutil -p ios/OpenReader/Info.plist` read `1.0.0` and build 9 (generated 2026-10-18) while the tree said `1.0.1 (11)-beta7`; a Metro reload cannot change those native numbers. `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1 npx expo prebuild --platform ios` (25 s with the CocoaPods cache warm) wrote `1.0.1` and `12`; the built and installed `Info.plist` and the Debug Log launch line (`native 1.0.1 (12)`) say which build is running.
- **A purchase check that only plants a file cannot tell "read and refused" from "never read".** Planting the old unscoped Unlock under the StoreKit path gives `not-started` either way. Add a control that must change the answer if the file is read: a version-2 envelope with a `production` Unlock (`plant-record.sh UDID v2`) turned the same unverified read into `access={"kind":"unavailable"}`, `Purchase, Unavailable`, and the "could not be verified" alert, so the file is read at launch.

### Verifying #325/#326, Tap Lock and Sleep Timer (1.0.2 (18)-beta1-debug) (2026-10-26)

Session-created `iPhone 16 Pro lock325` (iOS 27.0, `9B15E9E4-A8AC-4E53-8FEC-0F199352FCCF`), Debug app from a guarded `prebuild` + `xcodebuild RCT_METRO_PORT=8326` of the tree (worktree-specific derived data `/tmp/openreader-325-326-01/dd`), Metro 8326 from the same worktree, the kit's fake Kokoro on 8832, real book `Shadow Slave 1-250.epub` (256 spine items, a ToC page of 251 links, external links in the Foreword). New probe `player-and-reading-held/SleepMenuProbe.swift` opens the Player's native Sleep Timer menu and chooses an entry by title (`TEST_RUNNER_SLEEP_ITEM`, `TEST_RUNNER_SLEEP_EXPECT`).

- **An environment variable set to the empty string breaks `npx expo start` at once.** `CI= npx expo start --port 8326` died before printing the banner: `Error: GetEnv.NoBoolean:  is not a boolean` (expo's `env.js` reads `CI` with `boolish`, which rejects `""`). Symptom: no Metro, an error-only log. Fix: `unset CI` (or pass a real boolean); never export a switch as empty to quiet it.
- **The first synthetic touch on a bottom-row button was lost, and without a readback it reads exactly like a dead button.** The first `ax.py touch 'Lock Taps'` changed nothing (`say` still `tapLock=false`, label still `Lock Taps`); the identical second touch toggled it first try. Rechecked afterwards: six consecutive `ax.py touch` on the button, each read back from the tree, all six toggled (01:05). Cause not established; a LogBox banner over the row (next bullet) is one candidate. Fix: after every toggle read the button's label (or `say`) before trusting the touch, and retry once before suspecting the app.
- **A LogBox banner covers the Player's bottom row in a Debug build, and XCTest then taps nothing.** At 00:20 the probe's tap on the Sleep Timer logged `Computed hit point {-1, -1} after scrolling to visible` and the menu never opened; the first frame of that run's screen recording shows the yellow `Open debugger to view warnings.` banner lying across the row, and the Debug Log's warning at 00:20:01 is `Cannot connect to Expo CLI … URL: localhost:8326`. Rechecked: after three dark-to-light theme switches with no banner, six probe runs opened the menu and chose entries, none with a `{-1, -1}` hit point. Fix: before a probe, dismiss the banner (its ⓧ) or read the tree for it; a `{-1, -1}` hit point in `test.log` means the element was covered, not that the app ignored a tap.
- **The Sleep Timer's native SwiftUI `Menu` does not open from AXe or mobilebuildmcp taps — #311's "Sentences at once" again, in the Player.** Both touch paths reported delivery; the menu stayed shut. Fix: an XCTest tap. `SleepMenuProbe.swift` taps the button (label `BEGINSWITH 'Sleep Timer'`, which carries the state), waits for `When Current Chapter Ends`, asserts the seven entries (plus `Turn Off Timer` only while set, first, behind a divider, with the checkmark on the choice in force), and chooses a title passed as `TEST_RUNNER_SLEEP_ITEM`.
- **The open Sleep Timer menu's last row covers the button, so a second tap on the button chooses that row.** The menu opens upward; `1 Hour` sits over the moon. Dismissing by tapping the button again chose `1 Hour` (button label `Sleep Timer, 60:00 left`). That label's colon was then stripped from the attachment's suggested *filename* (`…"Sleep Timer, 6000 left"…`), which reads like a raw-milliseconds bug that does not exist — diagnose from the log or the snapshot, not the filename. Fix: dismiss by tapping outside the menu (the probe taps the title bar at `dx 0.5, dy 0.05`) and wait for the items' `exists == false`.
- **`run-probe.sh` terminates the app after a failed probe, and the next probe then finds the Library.** Any rc ≥ 65 (a failed assertion included) stops the target by design, so the reader, the Player and the armed Sleep Timer are gone — the follow-up run failed with "Sleep Timer button not found". Fix: restage (launch, open the Document, confirm the tree's buttons) before the next probe, and check the failure's kind first: a *setup* refusal (rc 2, e.g. silence) kills nothing.
- **Two `lock-device.sh lock-on` runners share one log and one simulator.** The second run truncated `$work/lock-on.log`, destroying the first runner's `waiting`/`pressing at` lines; its XCUITest session then kept the first from ever pressing (no `pressing at` line at all), and killing it left the app on the Home screen. A pause timed in that window proves nothing about the lock. Fix: one runner at a time (kill the duplicate's `xcodebuild` before touching either signal file), and treat `LOCKPROBE pressing at <unix>` plus the lock-screen screenshot as the only proof the device was locked.
- **`chapterOffered` is false until the page has reported the Document's spine.** Right after `open`, `say` printed `chapterOffered=false` with `spine=0` and the menu offered only the six lengths. Measured from the Debug Log: `opened` 00:16:20.859, the page `installed` 00:16:24.695, `known=118 … spine=256` at 00:16:25.211, about 4 s for this 256-section book, after which the chapter entry is offered. (An earlier reading of this as "about two minutes" compared samples taken minutes apart.) Fix: wait for `chapterOffered=true` in `say` before any chapter-end test.
- **The volume reset to 60 struck four more times in one evening, with nothing played** (the #148/#316 recurrence, iOS 27.0 session device). Every one was caught by `check` in the same breath as the play; `set && check && play` in one chain is the working shape.
- **The harness's fractional Sleep Timer lengths work as documented**: `{"do":"sleep","choice":0.1}` armed 6000 ms (`say`: `left":6000`) and `0.2` armed 12000 ms; both expired only while playing and self-paused after the sentence being spoken (`[reading] sleep timer: stop after sentence` → `the Sleep Timer paused the reading after utterance N` → `stop after nothing`), including with the device locked (`LOCKPROBE pressing at` 00:51:37.29, pause 00:51:49.86, lock screen verified by screenshot).

### Verifying #325/#326 again on the card Player (1.0.2 (18)-beta3-debug) (2026-10-26)

Same device and Metro; the tree at f7c7e13, whose open Player is a card 12 points in from the sides, its bottom edge 20 above the screen bottom, with the Tap Lock and Sleep Timer in a 32-point head row drawn from 44-point touch areas by a negative margin. Everything below met that card.

- **A non-atomic harness write poisons the file until it is deleted.** A plain `printf '{…}' > harness.json` truncated the file in place while the app's 250 ms poll was reading it; from then on every poll logged `[hx] harness threw: SyntaxError: JSON Parse error: Unexpected end of input` (three per tick, one per mounted poller) and **no command ran**, though `cat` showed the complete JSON on disk — for ~90 s, until the file was `rm`ed and rewritten. Even the atomic fix (write `.harness-<seq>.json`, then `mv` over `harness.json`) leaves a ~0.3 s window where the first polls read the renamed file as empty; a command overwritten inside that window is lost without a trace (a `taplock` was). Fix: always write to a temp file and rename, keep ≥3 s between commands, and read the command's effect back (`say`, a label) before sending the next one; if the throw ever appears, `rm harness.json` and write it fresh — editing the existing file does not clear it.
- **A drawer's Sheet Grabber does not answer a tap, and a covered Player button still answers `ax.py find`.** The Voice drawer (opened by `Choose a Voice`) stayed open after a tap on its grabber; the follow-up `touch 'Next sentence'` then reported a touch at the button's own centre while the drawer was still covering it, so no transport tap happened — the tree lists covered elements, exactly the #201 sheet pitfall in drawer form. Fix: close a drawer with a grabber **drag** — from full screen one drag reaches half and a second dismisses it — confirm the tree no longer lists the sheet (`grep -c 'Sheet Grabber'` == 0) before aiming at anything beneath, and re-read the tree immediately before each such touch.
- **A second simulator can reuse the same Debug `.app` and the same Metro.** For the 390-point check, `simctl create "iPhone 16e …"` on the iOS 27.0 runtime, `simctl install` of the existing `/tmp/…/Debug-iphonesimulator/OpenReader.app` (no rebuild), `silence.sh set`, launch — the app connects to the already-running Metro 8326 on its own; copy the EPUB into the new container's `Documents/Inbox/` and the shell-level harness `add` takes it (`{"do":"add","file":"…epub"}` answers `added sha256:…`). The fresh container has no Provider, so the card shows the red `No provider is enabled` note above the head row; the transport row underneath is still the compact one (Contents and the speed on Play's row), which is what the second device is for.
