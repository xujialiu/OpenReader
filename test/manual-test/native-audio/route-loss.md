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

## Driving the actual app's handler on the simulator (2026-10-11 run)

The installed Debug simulator app's real `handleRouteChange:` can be driven by
posting the system notification at it through LLDB while it plays:

```sh
lldb -p APP_PID --batch \
  -o 'expr -l objc -O -- [[NSNotificationCenter defaultCenter] postNotificationName:@"AVAudioSessionRouteChangeNotification" object:nil userInfo:@{"AVAudioSessionRouteChangeReasonKey": @2}]' \
  -o 'detach' -o 'quit'
```

Reason `2` is `OldDeviceUnavailable`, `1` reconnects; `AVAudioSessionInterruptionNotification`
with `AVAudioSessionInterruptionTypeKey` 1/0 and `AVAudioSessionInterruptionOptionKey` 1
drives the ordinary interruption pair. Every play must still sit behind a passed
`silence.sh check` chained with `&&`.

What this proves: the actual installed handler ran — the patched `pauseIfNecessary`
before event dispatch shows as `native engine.pause.request` (state=1 running=1)
followed by `engine.pause.done` (state=2 running=0) in the Debug Log, the later
rebuild preserves `state=2 running=0`, and JS's `pause.output-lost` arrives ~0.5 s
later (the async gap the fix closes) to find the engine at the route event's own
content coordinate — measured 3.66287 s twice, deterministically. Reconnect and
late interruption do not resume; explicit Play does; an interruption end with
`shouldResume` continues.

What it cannot prove: attaching LLDB stops every thread of the app for roughly
6–10 s while symbols load. During that window the page's word clock is frozen but
the wall clock runs, so when the hold lands the page has already interpolated to
near the utterance's final word, and a painted word at an utterance end cannot
distinguish held from sentence-finished. Engine-side positions and native
sequences are immune to this; the page-clock hold at a mid-sentence word is what
`use-reading-resume.test.ts`'s real-hook run establishes (word 0 held, not word 3).
On this run every hold request was also answered by the page's
`[renderer] playback received=hold … held=true` (78 of 78), and each paused state
read twice seconds apart stayed identical.

A quiet stretch can still put the simulator's volume back to 60 (the #109 round 2
pitfall) with nothing playing; `check` immediately before every play, and again
after any pause you intend to leave.

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
