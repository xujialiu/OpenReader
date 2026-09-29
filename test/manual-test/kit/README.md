# The kit

What every area uses:

- `run-probe.sh`: runs any XCTest probe (below).
- `project.rb`: generates the disposable XCTest project `run-probe.sh` and the
  area scripts build, finding a probe by its file name.
- `silence.sh`: the simulator's own volume, set to zero and checked (the top
  README).
- `lock-device.sh` with `DeviceLockProbe.swift`: the simulator's lock button,
  Home, and the lock screen's own Play and Pause (`downloads/download-away.md`,
  `downloads/download-beside-reading.md`).
- `cdp.cjs`: a warning capture or one expression evaluated in the running app
  (below); `cdp-rtt.cjs` and `cdp-profile.cjs` time its JavaScript thread.
- `hx.cjs`: one command to the walkthrough harness.
- `ink.py`: text-edge and highlight-band measurements from a screenshot, in
  points at its 3× scale (margins.md, bar-title.md).
- `reading.cjs`: the reading handler's state, pause, and a short Play (below);
  `play-shots.cjs` takes screenshots at chosen moments of one.
- `download-chapter.cjs`: downloads chosen chapters through the app's own
  offline runtime, or lists their ids.
- `node-kit.ts`: what the Node probes against Providers and books share.
- `frame-gaps.py`: hitches in a `simctl io recordVideo` recording.
- `debug-log.py`: copies the Debug Log off a phone, says what time it covers,
  and collects the phone's system log for that span (below).

## Run an XCTest probe

```sh
bash test/manual-test/kit/run-probe.sh PROBE SIMULATOR_UDID OUTPUT_DIR \
  [--mode MODE] [--bundle BUNDLE_ID] [--expect-player] [-only-testing:METHOD ...]
```

`PROBE` is the class, such as `AlignmentProbe`, whose `AlignmentProbe.swift`
sits in its area's folder. The runner checks the simulator's own volume first,
whether or not the probe plays. A new `OUTPUT_DIR` gets a new project. An
existing one is reused only for the same probe from the same worktree, and
refused otherwise: the project names its Swift file by absolute path. Each run
leaves `result-STAMP.xcresult`, `test-STAMP.log` and `attachments-STAMP/`, and
prints the `Executed … tests` line. The exit status is xcodebuild's, and 2 means
a usage or setup error.

- `-only-testing` takes `METHOD`, `Class/METHOD` or the full
  `LockScreenProbe/Class/METHOD`. Without it the whole class runs.
- Every other argument goes to xcodebuild unchanged.
- `--mode`, `--bundle` and `--expect-player` are read only by the probes that
  use them: `OfflineProbe`, `ReaderProbe`, `LibraryOpenProbe`, `LockScreenProbe`,
  `TwoFingerProbe` and `SettingsVersionProbe` (`--mode release`: a build without
  Debug Mode, whose version has no `-debug`).

A new probe is one Swift file, `NameProbe.swift` with `final class NameProbe`,
in the folder of the area it tests, and nothing else to register. Write a
script beside it only for what the runner does not do, such as staging, several
runs or reading the screenshots, and let that script call `run-probe.sh`, as
`downloads/two-finger.sh` does.

Measured 2026-09-29 on iPhone 17e (iOS 27.0):

- `two-finger.sh … -only-testing:TwoFingerProbe/testFilesBackTowardStart` built
  and passed in 41 s.
- `NativeReferenceProbe` failed its own `Keyboard has no switches` assertion on
  that runtime's Settings. xcodebuild's status 65 came back, with the
  attachments exported.
- Reusing that directory for another probe, or with a `probe.txt` naming
  another worktree, exited 2 before building.


## Read runtime warnings or evaluate a targeted expression

Prerequisites: the current repository's Metro server and one connected OpenReader
Debug target. The script uses Metro's installed `ws` dependency.

```sh
node test/manual-test/kit/cdp.cjs --warnings
node test/manual-test/kit/cdp.cjs --eval /tmp/targeted-expression.js
```

Set `OPENREADER_DEVICE` (e.g. `OPENREADER_DEVICE="iPhone 16"`) when two
simulators share one Metro — two worktree sessions on the same repository,
each with their own device — so the "expected one OpenReader debug target"
check narrows to the named `deviceName` instead of failing on two. Unset,
behaviour is exactly as before. `offline-playback.cjs` picks this up for free
by inheriting the environment into its own `cdp.cjs` calls; it separately
reads `OPENREADER_DOCUMENT_ID` to target a Document other than the short
fixture's historical id, for a Library seeded with a differently-built copy
of it (same title and chapters, different manifest digest). `OPENREADER_DEVICE`
is the Metro target's name; the silence check is a different question about the
same device and takes its UDID.

Warning capture includes buffered warnings and errors, without verbose stack
traces or ordinary playback logs. No output means no warnings were received in
that capture, not that all interactions have been tested. Restart the app against
a stable Metro before comparing runs: an old `Disconnected from Metro (1001)`
warning remains in the buffer. Keep Metro running for Debug delivery.

Evaluation prints the expression result and fails on a protocol/JavaScript error.
Use synchronous expressions: Hermes can return a Promise object before its work
finishes. Invoking a React handler through this tool is not a physical touch test.
Inspect only task-related state and avoid expressions that return credentials.
The optional final argument selects a different Metro URL.

### Capturing an async event (a WebSocket's `error`/`close`) across two `--eval` calls

Each `--eval` opens its own CDP connection and evaluates one synchronous
expression, so an event that arrives later — a refused WebSocket upgrade's
`close`, for instance — is not in that call's result. Split it into two calls
against the same running app, since Hermes's globals persist between separate
CDP connections: the first arms a listener that pushes each event into a
`globalThis` array and returns at once; after a pause for the network round
trip, the second reads the array back.

```sh
node test/manual-test/kit/cdp.cjs --eval arm.js http://127.0.0.1:PORT   # registers ws.onerror/onclose, returns 'armed'
sleep 3
node test/manual-test/kit/cdp.cjs --eval read.js http://127.0.0.1:PORT  # JSON.stringify(globalThis.__probe.events)
```

Used this way on 2026-09-22 against `wss://eastasia.tts.speech.microsoft.com/…`
with a wrong key, `new WebSocket(url, undefined, { headers: {…} })` produced
exactly the sequence ADR 0037 inferred from source but had not measured on a
device: a bare `error` event, then `close` with `code: 1006` and
`reason: "Received bad response code from server: 401."`. Restart the app
afterwards (or let the next `app.launch()` in a probe do it) to discard the
armed global.

## Inspect, stop or briefly exercise the reading handler

```sh
node test/manual-test/kit/reading.cjs state
node test/manual-test/kit/reading.cjs pause
node test/manual-test/kit/reading.cjs play-for 5 SIMULATOR_UDID
```

Open a Document first. `play-for` requires an explicitly chosen duration up to
10 seconds and a simulator whose own volume is zero; it names the device so it
can check that, and takes `SIMULATOR_UDID` from the environment instead when the
argument is left out. Five seconds
was used here to establish an active Now Playing session before a paused-card
inspection. The script pauses via both a host cleanup path and an app watchdog.
If either reports an unconfirmed pause, stop in the app and verify its state.
The duration includes synthesis/buffering and does not guarantee that audio
actually started. These handler calls are not touch tests; use `LockScreenProbe`'s `tap`
mode (`lock-screen/README.md`) for that. Run `state` afterwards to verify the final paused state.


## Pull the Debug Log off the phone

A build with Debug Mode (#82, ADR 0054; every Metro build, and a Release build
made with `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1` as `docs/install-on-iphone.md`
makes it) keeps the Debug Log in its container at `Library/Application
Support/debug-log/`: `debug-log-000001.txt`, `…000002.txt`, …, four files of at
most 5 MB, oldest deleted first, one line per event,
`2026-09-29 14:03:12.345 +08:00 [category] message`. After the owner reports a
fault, roughly when, copy it off and read the lines around that time:

```sh
python3 test/manual-test/kit/debug-log.py IPHONE_UDID OUT_DIR
python3 test/manual-test/kit/debug-log.py IPHONE_UDID OUT_DIR --syslog --pmd3 /tmp/pmd3-venv/bin/pymobiledevice3
```

- It copies the folder with `xcrun devicectl device copy from --domain-type
  appDataContainer --domain-identifier top.xujialiu.openreader --source
  "Library/Application Support/debug-log"` into `OUT_DIR/debug-log/`; if that
  leaves no `debug-log-*.txt`, it lists the folder with `devicectl device info
  files --subdirectory` and copies the files one by one.
- It prints the number of files, lines and megabytes and the first and last
  line's times, local with their offset and in UTC, and writes the same to
  `OUT_DIR/span.txt`.
- `--syslog` then runs `pymobiledevice3 syslog collect OUT_DIR/system.logarchive
  --udid IPHONE_UDID --start-time EPOCH` from the first line's time, and writes
  OpenReader's own lines of the span to `OUT_DIR/system-openreader.txt` with
  `/usr/bin/log show --archive … --predicate 'process == "OpenReader"' --style
  compact`. Every Debug Log line is among them as a default-level line of
  subsystem `top.xujialiu.openreader`, category `debug-log`, beside WebKit's and
  UIKit's. `--pmd3` or `$PMD3` names the executable
  ([pitfalls/physical-iphone.md](../pitfalls/physical-iphone.md) installs it
  into a throwaway venv). The archive runs from that time to now, and the
  phone keeps only about half a day of WebKit's lines, so collect soon.
- Exit 1 means the phone holds no Debug Log: the installed build has no Debug
  Mode, or the app has not run since it was installed.

On the owner's iPhone (iOS 27.0, 0.0.2-beta54) on 2026-09-29 at 20:53 the
whole-folder copy worked: one file, 3,626 lines, 0.6 MB, spanning 11:15 to
20:51; the pitfalls' #82 entry has it working over Wi-Fi too. `--syslog` was not
used that time: a separate `pymobiledevice3 syslog collect --start-time` over
the cable, from 20:25, took 12 s and wrote 325 MB, and `pip install` into a
fresh `/tmp/pmd3-venv` with the commands in
[pitfalls/physical-iphone.md](../pitfalls/physical-iphone.md) succeeded first
time.

What it cannot prove: the listing's JSON shape is `devicectl`'s, read from its
`--help` on Xcode 27.0 and not measured, so the fallback has never run against
a phone. The span and
the summary were checked against Debug Log files written by the test suite's
format. On 2026-09-29 the script also ran against a stand-in `xcrun` and
`pymobiledevice3` that copy two such files: the whole-folder copy, the fallback
through a listing, `--syslog` (`syslog collect … --udid … --start-time` with
the first line's epoch) and exit 1 for an empty folder did what is described
here.
