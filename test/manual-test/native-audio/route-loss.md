# Output lost before JavaScript pauses (#152)

Prerequisites: macOS command-line tools, Python 3, Swift, and `npm ci` with the
repository's patch-package patch applied. No device, provider, credentials,
network, or audible playback is used by these commands:

```sh
bash test/native-audio/route.sh
npx vitest run test/app/use-reading-resume.test.ts -t 'the highlight when output is lost'
swiftc modules/open-reader-debug-log/ios/PlaybackTraceBuffer.swift test/native-audio/trace-buffer.swift -o /tmp/openreader-trace-buffer
/tmp/openreader-trace-buffer
```

All commands exit zero on success. The first compiles the installed production
Objective-C route/rebuild/pause/interruption methods and the actual production
C++ queue, using the existing native-queue adapters. `route-probe.py` extracts
methods by their exact signatures, failing if an upgrade removes the seam.
AVAudioEngine hardware, session/event delivery and main-thread scheduling are
host adapters. A callback renders the real queue only when the substitute
hardware is running. The queue already holds a ten-second synthetic clip at
1.55x; after one second of rendering, the old hardware stops and the route-loss
method runs. JS receives the route event after 338 render quanta (0.9013 s).
The assertion compares the queue's continuation before and after that window.
It does not assume the replacement output is still reaching the old headphones.

Unfixed, this advanced 1.51674 to 2.91374 content seconds, skipping 1.397 seconds.
The fixed result is zero advancement. Controls deliver JS pause immediately or
omit route handling. Further assertions check that reconnect and a late
interruption end do not start a paused engine, an explicit Play does resume,
and an ordinary phone interruption still follows its resume permission.
`OPENREADER_ROUTE_TEST_DIR` selects an external build directory for inspecting
`probe.mm`, `methods.inc` and the binary. Default build artifacts use a fresh
temporary directory.

The second command mounts the actual `useReading` hook and executes the shipped
highlighter frame loop and hold receiver, with substitute DOM painting and frame
time. Manual pause is the control. When an engine-originated paused state arrives,
the highlight must stay at word 0 instead of advancing to word 3 at sentence end.
The engine and bridge are adapters here; the native test covers the route seam.

The Swift command compiles the production bounded native event buffer. It checks
10,000 writes retain only 128 events, report discarded events, preserve sequence
and origin times, drain to empty, and reject non-finite numeric fields. It reports
host elapsed time and retained JSON bytes; it does not benchmark phone overhead.

## Physical acceptance remains separate

Host rendering does not emulate AirPods auto-switch, Bluetooth buffered audio,
iOS thread scheduling or WebView suspension. After simulator verification,
install only with the owner's authorization and announcement. The owner plays
and switches AirPods to the Mac; the agent reads logs. Check foreground and
background, no unsolicited switch back, no continuing highlighter, and explicit
Play after reconnect without skipped speech. Record the last word heard and
first word resumed if any discrepancy remains. Do not infer the last audible
word from a render cursor or subtract a fixed guessed delay.

Read `docs/debug-on-iphone.md` to copy the Debug Log. New `[playback]` lines include
native origin wall time and uptime, native sequence, JS receipt wall time,
engine/source lifecycle and the latest reported numeric position with its age.
`[renderer] playback received=hold` is the page's acknowledgement, not merely the
app sending it. A position labelled `lastReportedPosition` is a sampled render
coordinate, not a measurement at the ear. Records contain no new document text.
A stopped or killed process can lose its unflushed native/JS in-memory batch;
these are diagnostics, not a crash-proof audio recorder.
