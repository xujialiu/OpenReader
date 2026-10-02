# Metro and the bundle

## Metro and the bundle

- **CDP reports no OpenReader target during a deliberate XCTest cold launch.** The old process has exited and the new bundle has not connected yet. Wait for the newly launched reader before inspecting it; this is not evidence of a broken Metro connection.
- **Fast Refresh invalidates native selection coordinates while a lookup drawer can retain its prior React state.** During #73 diagnosis, editing a highlighter comment reloaded the WebView and removed native handles while the prior result remained visible. Keep app source stable throughout a selection measurement; cold-launch and prepare the selection again after any app edit. A passing lookup-result assertion alone does not prove a handle drag: assert that the selected text changed too.
- **A one-shot `exists` check after tapping Close lookup can retain the old accessibility snapshot.** The original close probe tapped a real, hittable button and immediately read `exists`; it failed once even though a screenshot taken after the run showed the drawer gone. A replacement probe required the drawer to exist, queried a fresh element every 50 ms, and repeated three real close/reopen cycles. The drawer disappeared in 0.042 s for the first Translation cycle and in 0.025–0.201 s on later Dictionary cycles; a React Fiber walk over the connected debug target showed `LookupDrawer` present before the tap and absent after it. Keep this bounded wait and the precondition in close probes; a no-op close test is not evidence.

- **`npx expo install` in a fresh worktree fails with `Cannot find module 'tsx/cjs'`.** The local dependencies have not been installed; npx downloaded a temporary CLI, which cannot load this repository's config. Run plain `npm ci` first, then run `npx expo install` from the repository. If a legacy-peer install prunes the peer graph and a later npm install fails with `Cannot read properties of null (reading 'edgesOut')`, preserve the intended package.json changes, restore the pre-install lockfile, regenerate it with `npm install --package-lock-only`, then run plain `npm ci`. Do not delete or regenerate the whole dependency lock without retaining its pinned base.

- **The app runs code you have already changed.**
  - Cause: Metro started with `CI=1` does not watch files. It serves what it read at start, and its log says so once: "Metro is running in CI mode, reloads are disabled".
  - Fix: start it as `npx expo start --port PORT < /dev/null`. It will not prompt, because stdin is not a terminal.
  - To confirm the change is in what Metro serves: `curl -s "http://localhost:PORT/index.bundle?platform=ios&dev=true&minify=false" | grep -c <identifier from your change>`.
  - Ask a few seconds after the write, not in the same breath. Measured 2026-09-23: a bundle fetched straight after a `cp` put a file back still held the code the `cp` had replaced, and one fetched 3 s later did not. One stale answer is Metro's watcher catching up, not CI mode.
- **`npx patch-package PACKAGE`, making a patch, can run for minutes without
  writing it.** 2026-09-28 (#79): after `node_modules/@epubjs-react-native/core`'s
  two `template.js` files were edited, `npx patch-package
  @epubjs-react-native/core` was still running at the 120 s command limit, and
  `patches/` was unchanged. It installs a clean copy of the package to diff
  against, which is the likely wait. Fix: make the hunks with `git diff
  --no-index` between an original and the edited file, put them in the patch
  file in path order, then prove the patch the way a clean `npm ci` would:
  `git apply -R` the whole patch off `node_modules`, run `npx patch-package`
  (applying, which needs no network, answered `✔` at once), and check the
  edited lines are back.
- **The app's console lines can stop reaching Metro's log while the app stays
  connected.** 2026-09-28 (#79): the last line of Metro 8100's log was written
  at 09:54, straight after a `ZoomProbe` double tap, and nothing followed:
  - the app was still listed in `/json/list`;
  - `cdp.cjs --warnings` closed with 1006;
  - the "Open debugger to view warnings." banner was up;
  - the answer to a harness `js` command stood in the player's note and never
    appeared in the log, so `zoom.sh` gave up on it.
  Cause not isolated. A relaunch (`simctl terminate`, then `launch` with
  `-RCT_jsLocation`) brought the log back, and the same double tap then
  answered in it at once. When a script waits on Metro's log and gets
  nothing, look at the screen before blaming the app.
  It happened again on 2026-10-01 (#120): Metro 8160's log (started with
  `> /tmp/or-bug-metro.log`) stopped at 23:03:52, the app's harness answers
  went on reaching its Debug Log, and `webcontent-killed.sh` read `(no answer
  in 10 s)` for three runs before the tester found it. A script that needs an
  answer from a Debug Mode app now reads the `[probe]`/`HX` lines from the app's
  own Debug Log in the simulator's data container
  (`Library/Application Support/debug-log/`), as `webcontent-killed.sh` does.
  Restarting the app alone did **not** bring the log back (measured 23:29–23:31
  the same night: the relaunched app bundled 1473 modules from the same Metro
  and appeared in its `/json/list`, and still no `HX` line reached the file);
  terminating the app, restarting Metro itself (a fresh `npx expo start --port
  8160`, stdout a regular file) and relaunching the app did — the next harness
  command answered in the new log at once. When a stopped log matters and the
  answers cannot move to the Debug Log, budget a Metro restart, not just
  a relaunch.
- **A bundle made without an `EXPO_PUBLIC_` variable keeps the value of the bundle made before it** (2026-09-29, #82). `npx expo export:embed` without `--reset-cache`, run in turn with and without `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1`, printed `var DEBUG_MODE = true;` in both bundles. Cause: babel-preset-expo writes the value into the file's transformed code, and Metro's cache key is the file and the transformer's configuration, not the environment. The Xcode phase passes `--reset-cache`, but Expo drops it when `CI` is set, and the second bundle again came out `true`. Fix, in place since: `metro.config.js` puts every `EXPO_PUBLIC_` value under `transformer`, which Metro hashes into the key; each value then has cached files of its own (ADR 0054). Check a bundle with `grep -o "var DEBUG_MODE = [a-z]*;" main.jsbundle`.
- **The Xcode bundle phase's `--reset-cache` clears `os.tmpdir()/metro-cache`, which every Metro on the machine shares.** To keep a proof build from clearing another agent's running Metro's cache, point `TMPDIR` at a directory of the build's own in `ios/.xcode.env.local` (gitignored), which the phase sources: `export TMPDIR=/tmp/NAME/`. Measured 2026-09-29: the phase then wrote its cache there.
- **The bundle is stale or broken after `npm ci` or a new patch.** `node_modules` was replaced under a running Metro. Restart it with `--clear` and check the bundle as above.
- **A new worktree has no `node_modules`**, so `npm run typecheck` answers `sh: tsc: command not found` until `npm ci` has run. Plain `npm ci`, with nothing passed to it, is the whole command: 831 packages in 4 s, ending in `patch-package` (`@epubjs-react-native/core@1.4.8 ✔`).
- **`npm ci` stops with `ERESOLVE could not resolve`, naming `react-dom@19.3.0`.** From 538fa10 on 2026-09-22 until 2026-09-23 this was every new worktree's first wall, and `--legacy-peer-deps` was the way past it. It is now fixed at the root (#42, ADR 0039): `package.json` overrides `react-dom` to `$react`, so the lockfile holds the `react-dom` the pinned `react` peers with, and no command in this repository needs the flag. The symptom returns only on a branch from before that fix, or if the override is dropped — pass `--legacy-peer-deps` once to get moving, then merge `main`, rather than writing the flag into an instruction again. `react-dom` does not reach the iOS bundle either way: the same Hermes bundle hash comes out of both trees (engineering log, 2026-09-22 13:02 and 2026-09-23 02:48).
- **A port is taken by a Metro that serves another tree.**
  - Check with `lsof -nP -iTCP:PORT -sTCP:LISTEN`, then `lsof -a -p PID -d cwd`.
  - A cwd in another worktree, or under `.orca-worktree-trash`, is not yours. Take the next free port rather than stop something another session may be using.
  - The stale-directory case is also in `docs/install-on-simulator.md`.
- **The installed Debug app can follow another port without a rebuild**, but
  `xcrun simctl spawn UDID defaults write …` is not how, whatever it reads back.
  - Symptom: `xcrun simctl spawn UDID defaults write top.xujialiu.openreader
    RCT_jsLocation localhost:8084` is accepted, `defaults read` answers
    `localhost:8084`, and the app still fetches its bundle from the old port —
    it showed the *other* worktree's `ConfigError: The expected package.json
    path … does not exist` in a red box.
  - Cause: `simctl spawn` runs outside the app's container, so it writes
    `<device>/data/Library/Preferences/<bundle>.plist`, while the app reads
    `<device>/data/Containers/Data/Application/<uuid>/Library/Preferences/<bundle>.plist`.
    Editing *that* file with `plutil -replace` while the device is booted also
    changes nothing: the simulator's `cfprefsd` is still serving the old value.
  - Fix: terminate the app, `plutil -replace RCT_jsLocation -string
    localhost:PORT` on the **container** plist, then `xcrun simctl shutdown` and
    `boot` so `cfprefsd` re-reads it. Prove it from the app's own side rather
    than from `defaults`:
    `xcrun simctl launch --console-pty UDID top.xujialiu.openreader` prints
    `[RCTMultipartDataTask] GET http://localhost:PORT/.expo/.virtual-metro-entry.bundle…`,
    and the device then appears in `curl -s http://localhost:PORT/json/list`.
- **An Expo Debug build writes its own port back over `RCT_jsLocation` at every
  launch**, so the plist fix above does not hold for it.
  - Symptom (2026-09-22, iPhone 16, a Debug app built at 04:05 that day): the
    container plist, edited to `localhost:8089` with the device shut down, read
    `8089` after the boot and `localhost:8086` again as soon as the app
    launched. The app loaded from 8086, and 8089's Metro never logged a bundle.
  - Cause: Expo SDK 57's `adoptInfoPlistMetroPort()`
    (`node_modules/expo/ios/AppDelegates/ExpoReactNativeFactory.swift`), Debug
    only. It reads `RCTMetroPort` from the app bundle's own `Info.plist`, which
    `expo run:ios --port` bakes in, and writes `localhost:PORT` into
    `RCT_jsLocation` whenever the two differ. `plutil -p "$(xcrun simctl
    get_app_container UDID top.xujialiu.openreader app)/Info.plist" | grep
    RCTMetroPort` shows the port a build insists on.
  - Fix without a rebuild: copy the `.app` out of the device, `plutil -replace
    RCTMetroPort -string PORT` on the copy's `Info.plist`, `codesign --force
    --sign - --preserve-metadata=entitlements` the copy, terminate the app and
    `xcrun simctl install UDID COPY.app` over it. The data stays. The next launch
    logged `iOS Bundled … index.ts` in the new port's Metro and appeared in its
    `/json/list`.
  - A build whose `RCTMetroPort` is empty does not: `adoptInfoPlistMetroPort()`
    returns before writing anything, and the container's `RCT_jsLocation` stands.
    With a **fresh** container, which has no `RCT_jsLocation` at all, what stands
    is the default 8081 — another tree's Metro on this machine. Measured
    2026-09-23 02:58 (#42): `npx expo run:ios --device UDID --port 8090` built,
    installed on a device that had never held the app, reported "Waiting on
    http://localhost:8090" and opened it, and 8090 logged no bundle and answered
    `[]` on `/json/list`. So `--port` is what `run:ios` waits on, not what the
    app it opens asks. One `xcrun simctl terminate` and a relaunch with
    `-RCT_jsLocation localhost:8090` fixed it: `iOS Bundled 3791ms index.ts
    (1605 modules)` in that Metro, and the device in its `/json/list`.
    That is the other observation of the same day (**Simulators and installs**,
    "A fresh `expo run:ios` install still fetched its bundle from another tree's
    Metro"): the build `expo run:ios --port 8090` made at 12:29 has `RCTMetroPort`
    `""` in its `Info.plist`, and it kept a container's older `localhost:8087`
    until the plist fix above. So read `RCTMetroPort` in the bundle first: empty,
    use the plist fix; a port, re-sign a copy with the port you want.

- **A launch argument points a Debug app at another Metro port, with no plist
  edit and no reboot.** `xcrun simctl launch UDID top.xujialiu.openreader
  -RCT_jsLocation localhost:PORT` puts the value in the process's argument
  domain, which `NSUserDefaults` reads before the container plist the bullet
  above has to edit. Measured 2026-09-22: a Debug app freshly copied onto a new
  iOS 27.0 device fetched its bundle from port 8088 on its first launch, Metro
  logged `iOS Bundled`, and the device appeared in `/json/list` there. It
  belongs to the launch it is passed to, so pass it on every relaunch.
  On a **freshly created** device the first launch with the argument can still
  connect to nothing: measured 2026-09-29 (issue #86, a device created that
  minute), the app came up on the Library, fetched no bundle, and every
  Metro's `/json/list` stayed empty; a second `terminate` + `launch` with the
  same argument bundled at once. A fresh container's first launch races its
  own defaults; if `/json/list` on your port is empty and no Metro logged a
  bundle, just relaunch with the argument again before editing anything.
- **An existing probe's own `app.terminate(); app.launch()` drops that launch
  argument too, and reconnects to whatever Metro the container plist last
  held.** Every probe in `ios/` does this at the start of most methods
  (`OfflineFixProbe.testConfigureFishProvider` among them) because in the
  common case — one simulator, the default port — a bare relaunch reconnects
  to the same server. On a device kept on a non-default port by the launch
  argument alone (a dedicated worktree simulator, this file's own example),
  it does not: measured 2026-09-22, `xcresulttool`'s failure screenshot showed
  a red `ConfigError: The expected package.json path …/fix/package.json does
  not exist` — a **different, already-deleted** worktree's Metro, left over in
  the container plist from before this session repointed the device with the
  launch argument. `curl -s http://localhost:PORT/json/list` answered `[]`
  throughout. Fix as in the bullets above: `xcrun simctl terminate`, then
  `launch UDID BUNDLE -RCT_jsLocation localhost:PORT` **from the host**, not
  from inside a test — and prefer a probe method that only `.activate()`s an
  already-connected process when running against a device like this one.
- **The launch-argument fix above does not survive a probe's own internal
  relaunch, because the argument was never durable to begin with.** Passing
  `-RCT_jsLocation` to `simctl launch` only ever sets it for that one
  process; `DownloadRingProbe.testDownloadRingLifecycle`'s own
  `app.terminate(); app.launch()` at its start drops it exactly as the
  bullet above describes, every time, not only on a device that already had
  a stale container plist value. Measured 2026-09-24 on a **freshly
  created** worktree simulator whose container plist had no
  `RCT_jsLocation` key at all yet (`plutil -p` printed nothing for it): the
  probe still red-boxed with `ConfigError: The expected package.json path
  …/fix/package.json does not exist` — a different worktree's path baked
  into this particular copied Debug build's own compiled-in default (see
  "An Expo Debug build writes its own port back…" below), reached the
  moment nothing else overrode it. A launch argument cannot fix this
  durably, because the very next in-test relaunch drops it again. Make the
  **container plist itself** correct instead:
  `plutil -replace RCT_jsLocation -string localhost:PORT` on
  `<device>/data/Containers/Data/Application/<uuid>/Library/Preferences/<bundle>.plist`,
  then `xcrun simctl shutdown` and `boot` so `cfprefsd` reads it (as the
  bullet after next already documents for a different cause) — after that, a
  bare in-test relaunch keeps landing on the right Metro, proven across five
  further `app.terminate(); app.launch()` cycles the same day. Re-silence
  and re-set the launch argument after the boot too (a boot resets
  `sim_volume` to 60 regardless).
- **Reusing another worktree's installed Debug app is safe only while the native
  side matches.** Compare `git diff --name-only main` against `package.json`,
  `app.json`, `plugins/` and `patches/`; a change to `patches/` or to a
  `scripts` entry is JavaScript and rides over Metro, a change to a dependency
  or a config plugin is not.
- **The kit's CDP scripts talked to port 8081 whatever port this tree's Metro
  is on.** `reading.cjs` and `voice-playback.cjs` had `127.0.0.1:8081` written
  in, and `offline-playback.cjs` goes through `cdp.cjs`, whose default was the
  same. On 2026-09-22 every port from 8081 to 8084 held a Metro serving a
  deleted worktree, so this tree's was on 8085 and the scripts found no target,
  or the wrong device's.
  - Fix: `OPENREADER_METRO=http://127.0.0.1:PORT` in the environment; `cdp.cjs`,
    `reading.cjs`, `voice-playback.cjs` and `stop-on-word.cjs` all take it.
- **A detached shell can let a newly started Metro exit immediately.** On
  2026-09-22 `npx expo start --port 8092 < /dev/null > /tmp/metro.log 2>&1 &`
  returned without a process or log, so the port never opened. Run Metro in a
  persistent terminal session and check its cwd, `/status`, and the bundle
  before launching the app.
- **A Metro started as an agent's background task ends with that agent's
  session**, and the simulator's app is left pointing at a dead port. Measured
  2026-09-24: the #52 session had run `npx expo start --port 8088` as its
  background task, the next session's process started at 01:44:24, and the
  Metro's log stopped at 01:44 although an open reader logs on a timer. At
  01:49, 8088 was free and the app still running. Such a Metro is a child of
  the agent's own process; every Metro that had outlived its session had PPID 1.
  Fix, for a Debug delivery that must outlast the session: give Metro a session
  of its own, `nohup python3 -c 'import os; os.setsid(); os.execvp("npx",
  ["npx", "expo", "start", "--port", "PORT"])' < /dev/null > LOG 2>&1 &`, and
  check that its `npm exec` answers 1 to `ps -o ppid= -p PID` and `/status`
  answers `packager-status:running` after the call returns. It outlives the
  worktree too: stop it by PID when the worktree goes, or it joins the six that
  were still serving `.orca-worktree-trash` that morning.
- **Fast Refresh can leave the old screen up while Metro serves the new code.** 2026-10-01 22:00 (#117 batch 3): after `lookup-drawer.tsx` and `drawer.tsx` changed, the lookup drawer still showed its old header in the tree, and `touch`ing both files did not change it, while `curl …/index.bundle?platform=ios&dev=true&minify=false | grep -c LOOKUP_MODES` found the new code. A relaunch showed it. Grep the bundle, then relaunch rather than trust what is on screen.
- **A tool call that times out takes a Metro it started with it.** 2026-10-01 (#117 batch 3): `(nohup npx expo start --port 8152 < /dev/null > LOG 2>&1 &)` in a call that then ran `simctl install` and timed out at 180 s left `LOG` at "Waiting on http://localhost:8152" and nothing listening (`curl /status` exit 7), so the app sat on a white screen. Start Metro in a call of its own that returns at once (`nohup … & disown`), and check `/status` in the next one.
- **The `npm exec` of a Metro started that way may not answer 1 for its PPID,
  and that does not mean it will die with the session.**
  - Symptom (2026-09-28 05:59, #77): the tool call ran `cd TREE && nohup
    python3 … setsid … &` followed by `sleep 20; lsof …`. After it returned,
    `ps` showed the call's `/bin/bash -c` still alive with PPID 1. `npm exec`
    had PPID equal to that bash, not 1. The check in the bullet above fails.
  - Cause: the `bash -c` that ran the call waits for its background job, and
    it is that shell, not `npm exec`, that is reparented to launchd. The
    #75 Metro on 8091 (PIDs 54466/54468/54490/54491) had the same shape.
  - Fix: check that `npm exec` has a session of its own (`ps -o pid,ppid,pgid`
    shows its PGID equal to its PID, and `STAT` contains `s`) and that its
    parent chain reaches PID 1. When stopping that Metro, stop the `bash -c`
    wrapper as well.
- **A PTY wrapper can buffer the Metro log that a probe reads while it runs.**
  On 2026-09-24 `script -q /tmp/metro.log npx expo start --port 8095` let the
  app answer its harness commands, but `SyncProbe.settleAt` read no `section=`
  line until the wrapper stopped, so the probe reported three false failures.
  Use a flushing wrapper (`script -q -F`) or a durable Metro whose stdout is a
  regular file, and verify that a newly written `HX` line is visible from a
  second shell before using that path as `METRO_LOG`.
- **`watchfetch` misses the first request the app makes as it starts.** The
  shell asks every enabled Provider for its Voices on mount (#24), and the
  harness's first poll is 250 ms later, so with `watchfetch` already in
  `harness.json` at launch the log shows Fish's listing pages 2–4 and never
  page 1. Page 1 was sent; its absence from the log proves nothing.
- **`simctl launch --console-pty` piped through `timeout` and `grep` printed
  nothing at all**, right after repointing a Debug app's `RCT_jsLocation` to a
  new Metro and rebooting the device (the fix two bullets up). `timeout 12
  xcrun simctl launch --console-pty UDID BUNDLE | grep -i bundle` produced no
  output — not even a first "Bundling" line — which reads exactly like the app
  still not reaching the new port. It was reaching it: a plain `xcrun simctl
  launch UDID BUNDLE` right after, with no pipe, showed a `Bundling NN%…`
  banner on a `simctl io screenshot` within a few seconds, and `curl -s
  http://localhost:PORT/json/list` (empty immediately after `launch`, since the
  debug target only registers once the bundle finishes and the inspector
  connects) listed the device once that finished. Cause not isolated further
  (`timeout`'s signal racing the pty's buffering through the `grep` pipe is the
  suspect). Fix: prove a repointed Metro connection with a plain `simctl
  launch` plus a screenshot and a couple of seconds of polling `/json/list`,
  not `--console-pty` piped through `timeout`/`grep`.

- **A second Metro for a control run answered from another worktree, and the cleanup stopped that one** (2026-09-29). Symptom: `npx expo start --port 8099` printed only `Starting project at …/long_press`, yet `curl localhost:8099/…bundle` answered with an error naming `…/openreader/bug/.` as the project root; `kill $(lsof … :8099)` and `pkill -f "expo start --port 8099"` then stopped that Metro (an orphan: its worktree had already been deleted). Cause: the port was taken, the new Metro did not listen, and the request reached the old one. Fix: before starting, `lsof -nP -iTCP:PORT -sTCP:LISTEN` must print nothing; after starting, `lsof -a -p PID -d cwd` of the listener must be your worktree; stop only PIDs whose cwd is yours.
- **An XCTest probe's `app.launch()` does not carry `simctl`'s launch
  arguments, and the Debug app then loads from the container's stale
  `RCT_jsLocation`.** Measured 2026-09-29 (#85, `ReaderTitleProbe`): the
  simulator app had been launched by hand with `-RCT_jsLocation
  localhost:8085` all day, but the probe's plain `app.terminate();
  app.launch()` started it without the argument, the app read the container's
  stored `RCT_jsLocation` — `localhost:8081`, not this tree's Metro — never
  reached the reader, and the probe failed 4 assertions ("Reader never became
  ready", no "More actions", no title element) before any of them could say
  anything about the app. Fix: set the argument on the probe's own launch —
  `app.launchArguments = ["-RCT_jsLocation", "localhost:" + port]`, the port
  from `TEST_RUNNER_OPENREADER_METRO_PORT` (xcodebuild hands the runner the
  variable without its prefix), as `ReaderTitleProbe.swift` does — the same
  rule the manual launches already follow.
- **Away from the screen, the app's console lines can miss Metro, and the
  Reader's status line can stop.** Measured 2026-10-01 03:07 (#112,
  `iPhone 17 bug112`, a Reading playing with the app in the background): the
  Debug Log recorded `[renderer]` lines at 03:08:00 and 03:08:32, while Metro's
  log had no `HX` line from the play to the pause, and the Debug Log's own
  `[hx] playing=` line stopped a second after the app left. An earlier run the
  same night had status lines in Metro while away. Fix: judge a background run by
  the Debug Log's `[renderer]` and `[app]` stamps, read after the app is back in
  front (which appends what was waiting), as `background-crossing.sh` does.

- **`curl http://localhost:8081/reload` does not reload the native app on Expo CLI's Metro.** 2026-10-01 (#117 verification): the classic RN reload endpoint answered the React Native **web** index HTML (`<script src="/index.ts.bundle?platform=web…">`), the app on the simulator did not reload, and its drawer stayed up. To reload natively, press `r` in the Expo CLI's own terminal, or `xcrun simctl terminate` and `launch` the app (a cold remount — the drawer's JS state is lost either way). Probing a Fast Refresh without editing app source has no remaining route: an HMR update comes only from a file change.
- **A harness `saysettings` answer can lag the app's real state by many seconds in both Metro's log and the Debug Log file.** 2026-10-02 (#122 verification): three reads taken 4–60 s after a palette touch still printed the previous highlight colour, while screenshots taken in between already showed the new one in the sample. The poll and the handlers run at full speed; it is the log pipeline that flushes late. Judge a change's latency by burst screenshots against the screen, and treat a stale harness answer as a reason to read again, not as app state.
