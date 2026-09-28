# A download away from the screen, and beside a Reading (#75, #76, #77)

`download-away.cjs` hands chapters to the runtime's `enqueue`, waits for the
first ten clips, then takes the app away for `AWAY_SECONDS` and brings it
back, printing the clip count and the task's state every 5 s and a summary of
when clips were saved relative to leaving and coming back. The clip times are
the files' birth times in `Documents/offline-narration-v2/<document>/<voice>/`,
so the timeline holds while the app's JavaScript cannot answer; the task's
state is read through `cdp.cjs` whenever it can. At the end every chapter of
the task is paused through `toggleTask`, so nothing goes on spending.

```sh
export OPENREADER_METRO=http://127.0.0.1:PORT   # not localhost (Pitfalls, cdp.md)
node test/manual-test/downloads/download-away.cjs home     UDID DOCUMENT_ID fish VOICE 90 nav.2 nav.3 …   # Settings in front
node test/manual-test/downloads/download-away.cjs lock     UDID DOCUMENT_ID fish VOICE 90 nav.19 …        # device locked
node test/manual-test/downloads/download-away.cjs play     UDID DOCUMENT_ID fish VOICE 20 nav.16 …        # a Reading plays
node test/manual-test/downloads/download-away.cjs playlock UDID DOCUMENT_ID fish VOICE 120 nav.23 …       # a Reading plays, locked
```

Prerequisites: Fish configured (`OfflineFixProbe … -only-testing:testConfigureFishProvider`),
the Document in the Library (`{"do":"add"}` through the harness), and the
chapter ids from `download-chapter.cjs … --list`. Choose chapters without saved
audio: a chapter already complete is skipped and saves nothing. `play` and
`playlock` open the Document, choose the voice through the harness, set the
simulator's volume to zero and check it immediately before Play, and pause
afterwards; the duration is the away time, so derive it from what is measured
(20 s shows whether clips stop; crossing a chapter boundary while locked needs
about a minute more than the chapter takes). Until #75 the app held every
download back while a Reading played; the notes of 2026-09-28 name a
`PRETEND_NOT_PLAYING=1` that bypassed that hold after Play, by calling the
runtime's `playbackActive(false)`, to measure a download beside a Reading
before the app allowed one. The hold and the option went with #75: `play`
and `playlock` now measure the app as it is.

`lock-device.sh UDID lock|unlock` presses the simulator's own lock button
through XCTest (`DeviceLockProbe.swift`, `pressLockButton` by selector) and
opens it again with two Home presses; the first call builds the probe into
`/tmp/openreader-lock-device` (about 30 s, and again whenever the probe's
source is newer), later calls take 15–35 s, and the press comes about 20 s
into the call, so `away (locked)` is marked about 4.5 s after the actual lock
(`lock.log`'s `Pressing lock button` is the real moment; Pitfalls,
[lock-and-background.md](../pitfalls/lock-and-background.md)). What neither
can show: the phone's own background time (the simulator's was longer than
the phone's usual half minute), and anything about the system's continued
processing tasks, which the simulator does not run. A simulated lock passes through `active` once on the way (Pitfalls,
simulators.md).

`download-lock-at.cjs` locks at a moment of the download it chooses, for what
a lock at an arbitrary moment rarely meets: a chapter boundary crossed while
locked, or a preparation out when the app leaves (#76). It starts
`lock-device.sh UDID lock-on FILE` first, which waits in `testLockOnSignal`
and presses within about 0.05 s of FILE appearing, enqueues, samples the task
about four times a second, and creates FILE when WHEN holds; then it watches
AWAY_SECONDS locked, unlocks, brings OpenReader back, watches 40 s and pauses
every chapter of the task, like `download-away.cjs`.

```sh
node test/manual-test/downloads/download-lock-at.cjs UDID DOCUMENT_ID fish VOICE 120 left:5 nav.69 …     # lock with five texts of the chapter left
node test/manual-test/downloads/download-lock-at.cjs UDID DOCUMENT_ID fish VOICE 90 preparing nav.130 …  # lock while its text is being prepared
```

`left:N` reads the chapter's saved count from the progress the Download
drawer also asks for (`requestProgress`, asked once). `preparing` needs a
chapter whose text is not prepared and a download not already running, so
that the hidden rendering mounts first and the preparation takes 1–5 s; the
app leaves the screen 0.5–0.8 s after the press. Measured 2026-09-28 (#76):
`left:5` — the next chapter, prepared ahead, began 3.8 s after the lock and
saved 20 clips until the background time ran out 31.6 s after it;
`preparing` — the preparation was withdrawn as `PreparationInterrupted` the
moment the app went inactive, and the download read `interrupted` for 104 s
and went on 1.2 s after the return.

To see how each preparation ends, a probe through `cdp.cjs` can poll
`preparationRequest()` every 100 ms and wrap the returned request's own
`resolve` and `reject`, which the runtime calls on it, so a rejection's name
and message are logged without changing what happens (restart the app
afterwards; Pitfalls, cdp.md). Stutter while a download starts is measured on
a `simctl io recordVideo` of `fling-jump.sh`'s flicks: the recording has a
frame only when the screen changes, so a gap between frames while the page
moves is a hitch (`frame-gaps.py VIDEO`). Every flick's first frame comes
62–67 ms after the last, with or without a download; measured 2026-09-28, a
download's start added one 242–373 ms hitch 0.3–0.8 s after the enqueue,
whether or not it prepared anything, and the ten preparations ahead that
followed added none.

Three tools for every chapter prepared ahead (c7de45e) and the JavaScript
thread under it, with `OPENREADER_METRO=http://127.0.0.1:PORT`:

```sh
node test/manual-test/downloads/download-ahead.cjs install DOCUMENT_ID 10     # in-app: every request, AppState, lag; until a relaunch
node test/manual-test/downloads/download-ahead.cjs fail SECTION MAX           # handler probe: fail that section's requests MAX times
node test/manual-test/downloads/download-ahead.cjs read [OUT.json]            # requests in order, overlaps, missed tokens, durations, lag
node test/manual-test/kit/cdp-rtt.cjs SECONDS [INTERVAL_MS]             # the thread's answer time, from outside
node test/manual-test/kit/cdp-profile.cjs FILE SECONDS OUT.json         # Hermes's sampler around evaluating FILE
bash test/manual-test/kit/lock-device.sh UDID home | home-on FILE       # a real Home press (axe's does nothing)
```

Measured 2026-09-28 on `iPhone 17 download` (iOS 27.0), Debug `0.0.2-beta45`
(8aa75f6), Fish `s2.1-pro-free` at five at once, the Mac on a phone's hotspot;
artifacts in `/tmp/openreader-final-sim/`:

| Run | What happened |
| --- | --- |
| 40 fresh chapters of *My Vampire System*, Home after 11 | writer's first preparation 10.4 s; 18 ahead in 1.9 s, then the one out withdrawn as `PreparationInterrupted` in the same ms as `inactive`; no request for 24.4 s away; again 115 ms after `active`, all 40 prepared 3.1 s later, 32 s before the first chapter was written; list order, no overlap |
| Every chapter (2,077) of a 34 MB Chinese book, 300 s in front, reader open | 794 prepared, 795 requests seen at 10 ms, no overlap; median 263 ms outside XCTest launches, first and last hundred 275 and 254 ms, slope −0.16 ms per chapter prepared; JS lag worst-per-second median 25 ms (17 with nothing running); CDP round trip median 4 ms, p95 62, max 447; flings at 30, 150, 260 s: frames p95 33 ms and 1–3 gaps over 100 ms, against 37–42 ms and 2–5 with no download |
| The same book's download resumed in a new process, profiled | one JavaScript stall of 1.7 s (2.5 s in the run above), all in `injectWebViewVariables` of `@epubjs-react-native/core`: the hidden rendering's `Reader` puts the whole EPUB, base64, into its HTML template, and 14 `String.replace` calls scan it (#78) |
| `fail` 1, 2, 3 times | 1: one warning, retried after the next chapter, never `preparing`; 2: two warnings, the writer read `preparing` and prepared it; 3: `blocked`, `Provoked failure 3` |
| `download-away.cjs playlock` 120 s, fresh nav.229–232 | three chapter boundaries 2.6, 52.8 and 109.7 s after `background`, all prepared ahead 40 s before the lock; no `expired` in 155.8 s; never `interrupted` |
| `download-lock-at.cjs … left:30`, nothing played, new process | next chapter 17.5 s after `background`; `expired` 27.0 s after it, `interrupted` 0.12 s later with no error; `downloading` 0.25 s after the return |
