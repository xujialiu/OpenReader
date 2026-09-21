# Notes

Measured findings live in dated files beside this one
(`NOTES_YYYY-MM-DD.md`, each entry carrying the time it was found), in the same
shape as the Zotero-TTS repo's log. **This file is not one of them**: it is the
standing list of things still assumed, and it is meant to shrink. See ADR 0015
for why a measurement, a decision and a product argument each live somewhere
different.

What follows is what is assumed but **not verified**. Each is cheap to settle and
expensive to get wrong later. The list was opened while planning on 2026-09-19;
items are struck as they are answered, and the answer goes in that day's log.

## Verify before writing much code

1. ~~`String.prototype.normalize('NFKC')` on Hermes~~ — **yes.** Measured
   2026-09-19; see `NOTES_2026-09-19.md`.
2. ~~`TextDecoder` on Hermes~~ — **yes.** Same measurement. But `Intl.Segmenter`
   is **absent**, which was not on this list and makes the `unicode-segmenter`
   polyfill mandatory rather than optional.
3. ~~**CFI round-trip against Zotero, both directions.**~~ — **settled.**
   Measured 2026-09-21 on four books, 132,467 Blocks, both directions, live in
   Zotero; see `NOTES_2026-09-21.md`, 17:11. An **element** CFI names the same
   paragraph on both sides for every `.xhtml` book tested; the seam is
   OpenReader's HTML parse of `.html` members, which the text anchor covers.
4. ~~A 60–90 minute backgrounded playback session on a real device~~ — **the
   three named failure modes are answered; two things are not.** 2026-09-20,
   17 minutes backgrounded on the simulator, 10½ of them reading: the audio
   session did not go inactive between Clips, the Keychain did not refuse the
   key (79 Clips fetched while backgrounded), and a drained buffer queue
   behaved as footgun 3 says — silence, still playing, no crash. Still open,
   and narrower than it was: **the screen was never locked**, because nothing
   on this machine can lock a simulator (see `NOTES_2026-09-20.md`, 04:13), and
   locking is a stricter state than backgrounding; and this was a simulator, so
   it says nothing about a real device's power management. The same run found a
   separate defect that is not about audio at all — a reading stops at the end
   of the sections the renderer has rendered and does not resume — recorded in
   that day's log at 04:43.
5. ~~Lock-screen support in `react-native-audio-api`~~ — **audited, answered.**
   Insufficient on iOS; see ADR 0016.
6. **Whether the *Piper - Neural TTS* app's system-wide voices emit word
   markers.** If they do, free offline neural voices with word timing cost this
   project nothing at all.
7. **Sentence-splitting quality on real books**, against the constructed cases in
   the plugin's `test/fixtures/` — CJK, Romanian diacritics, angle brackets,
   numbers. Reworded: Hermes has no `Intl.Segmenter`, so what is being judged is
   the polyfill's output, not the platform's. It is the first segmenter, not the
   final one.

## Footguns found while auditing the playback library, before writing any of it

These were read out of the library's source, not its documentation, and each one
fails in a way that looks like something else.

1. **`setAudioSessionOptions` must be given `iosCategory` and `iosMode`
   together.** The JS wrapper substitutes an empty string for whichever one is
   omitted, the empty string matches no case and becomes `nil`, `setCategory` is
   called with a nil category, the session never activates, and playback silently
   produces no sound. Passing `{ iosMode: 'spokenAudio' }` alone is enough to do
   it. The documented warning only covers incompatible *combinations*, not
   omission.
2. **Pause on a route change of `OldDeviceUnavailable` yourself.** When the
   headphones come out the library rebuilds the engine and keeps playing — so the
   book starts reading itself aloud through the speaker unless the app pauses on
   that event.
3. **A drained buffer queue is safe.** It renders silence and stays in the playing
   state, then resumes on the next buffer, as long as `stop()` and `pause()` are
   never called — buffer exhaustion cannot schedule a stop. But do not call
   `suspend()` while backgrounded: a stopped engine under an active playback
   session is what puts the app at risk of being suspended.
4. **Elapsed time on the lock screen is never derived from the graph** — it is
   pushed by the caller on every change, and the reference cadence in the
   library's own example is once a second.
5. The stable version installed is a maintenance branch, not the development
   line. Two notification improvements that landed after it forked are not in it,
   and neither fixes the defect in ADR 0016.
6. **`pitchCorrection: true` must be passed when the source node is created**, or
   `playbackRate` is a resampler. The WSOLA time-stretch ADR 0009 requires is in
   the library — `common/cpp/audioapi/dsp/WsolaTimeStretcher.{h,cpp}`, native on
   both platforms — but it is opt-in per node:
   `pitchCorrection_(options.pitchCorrection)`, with the source's own comment
   "late init to avoid unnecessary allocation when pitch correction is not used".
   Omitting it raises no error and changes no API; the book is simply read in a
   rising voice, which sounds like a bad provider or a wrong sample rate rather
   than like a missing flag. `createBufferQueueSource({ pitchCorrection: true })`.
   `WsolaTimeStretcher::MAX_PLAYBACK_RATE` is 4, so the app's 1.5–3× is in range
   and clamping is not a concern.
7. **The queue node mixes two sample-rate bases in its own position, and the
   clock is the casualty.** Read from `AudioBufferQueueSourceNode.cpp`:
   `vReadIndex_` is *seeded* from the buffer's own rate (line 68,
   `buffers_.front().second->getSampleRate() * offset`) and then *divided* by
   the context's (line 156, `sampleFrameToTime(vReadIndex_,
   getContextSampleRate())`), while the other term, `playedBuffersDuration_`,
   accumulates `size_ / getSampleRate()` — the buffer's rate again
   (`utils/AudioBuffer.hpp:113`). The single-buffer `AudioBufferSourceNode`
   beside it does the same calculation consistently, against
   `buffer_->getSampleRate()` (line 119), which is what makes this look like an
   oversight rather than a convention.

   It is invisible whenever a buffer's rate equals the context's, and it
   corrupts **the one number ADR 0012 rests everything on** when they differ —
   a 24 kHz Clip in a 48 kHz context also plays at double speed, because nothing
   in the queue path resamples. So the `AudioContext` is created at the first
   Clip's own rate rather than the hardware's, and a later Clip that disagrees
   is resampled before it is enqueued.
8. **`pitchCorrection: true` makes the node play content nobody enqueued.** The
   host object builds a ~30 ms tail buffer on the first `enqueueBuffer`, and on
   every drain appends it *instead of* ending the last buffer — which also
   suppresses that `onBufferEnded` until the tail has been consumed. Anything
   deriving an Utterance boundary from buffer-end events, or summing enqueued
   durations without absorbing the excess, drifts by 30 ms per drain.
9. **`getLatency()` is the time-stretcher's latency, not the output device's.**
   It is built from the WSOLA constants (`INPUT_LATENCY_MS = 20`,
   `OUTPUT_LATENCY_MS = 10`) with a rate factor that matches neither unit
   derivation, so it answers a question nobody asked. The 150–200 ms of a
   Bluetooth route that ADR 0012 names is not exposed anywhere. Both are
   constant offsets rather than drift, so the highlight takes one latency
   parameter and the device session supplies it.

## What rests on reasoning alone — collected 2026-09-20

Three agents each ended a session by listing what they had argued rather than
measured. **Those three lists had never been collected**, so nobody could read
"where is this app actually unproven" off anything. This is that collection, out of
`NOTES_2026-09-19.md`, `NOTES_2026-09-20.md` and the ADRs, with what would settle
each item and roughly what settling it costs.

It is not a to-do list. Several items are unprovable here by construction and say
so; the value is in knowing which. Closing one means moving it into the list above
or striking it here with the day's log named.

### Closed in the 06:38 pass, from Node

- ~~**A message sent to the WebView before its program installs is lost silently.**~~
  The premise of the re-sent `inset` that 01:45 called "asserted, and never observed
  working". Settled in a `vm` context: nothing thrown, nothing reported, window
  untouched. `NOTES_2026-09-20.md`, 06:38.
- ~~**`firstUtteranceOfSection` reading `spans[0]` rather than the last span is
  unobservable.**~~ The 01:22 sweep's one survivor. The invariant it rests on is now
  asserted at the call site, on the field the call site uses — and the measurement
  found that it also rests on `ReportedBlock.section` being populated, which nothing
  was checking. Same entry.

### Needs the device, or hardware the device does not have

- **The literal lock screen has never been seen.** `SBSLockDevice` is refused by
  SpringBoard, DeviceHub has no window, `simctl` has no lock subcommand, and the HID
  path Simulator's own menu uses is a host-side private API (04:13; ADR 0016). What
  stands in for it is SpringBoard's own log holding our item and our rate. *Would
  establish it:* one real iPhone, one screenshot. *Cost:* minutes, once there is a
  device — nothing on this machine will do it.
- **The headphone remote is untested by construction.** The `togglePlayPause` command
  it sends is tested from another process; the radio is not (04:13; ADR 0016).
  *Would establish it:* a real device and a pair of AirPods. *Cost:* minutes, same
  precondition.
- **Locked-screen playback, as distinct from backgrounded playback.** `NOTES.md` item
  4 above is answered for 17 minutes backgrounded on the simulator; locking is a
  stricter state and the screen was never locked (04:43). *Would establish it:* the
  same run on a real device with the screen locked. *Cost:* 60–90 minutes of a real
  device, unattended.
- **A real device's power management.** Everything above was a simulator, which
  suspends nothing. *Would establish it:* the same run, same device. *Cost:* the same
  60–90 minutes — one run answers both.
- **iOS's touch-to-click step.** Every tap measured on 2026-09-20 was a `click`
  dispatched into the section's document, because no harness on this machine can
  deliver a physical touch (00:59, 02:50, 03:50). The hit-test guard, the tapped
  word, the contents row and the chips were all driven that way. *Would establish
  it:* one tap, by a finger or by XCUITest. *Cost:* minutes on a device; an
  afternoon if it is to be a UI test that runs again.
- **No button on the Appearance sheet was ever pressed.** The rows were driven
  through the `onChange` the chips call (02:50). *Would establish it:* the same tap.
  *Cost:* as above, and the same run covers both.
- **The React Native process's memory slope is not trustworthy.** 0.345 MB per
  Utterance against ADR 0011's 0.104, with the temporary harness running *inside*
  that process holding six thousand log lines and rewriting a file twice a second
  (05:52). The WebKit column, which is the one the change could have ruined, is
  inside noise of ADR 0011's. *Would establish it:* the same 18-minute reading driven
  from outside the app process. *Cost:* one device session, plus writing the
  out-of-process driver — the 03:50 Objective-C harness is the shape of it.
- **Three of the four resume refusals have never been on a screen** —
  `ambiguous`, `anchor-not-matchable`, `no-utterance` (05:57). Their resolution is
  tested in `cursor.ts`'s suite; what is unseen is the sentence rendered. *Would
  establish it:* three Library files written to produce each, three opens. *Cost:*
  under an hour, no new mechanism — the same trick the other two were seen with.
- **The 40 ms Hermes digest in ADR 0004 is a prediction**, scaled from a Node
  measurement and a Hermes throughput; and the two `FileHandle` reads that precede it
  are covered by no measurement at all. *Would establish it:* open one real book on
  the device and log the time around `documentId`. *Cost:* minutes, inside any
  device session.
- **Glyph coverage in the system font** (00:59) is device-only and is not a property
  of the code. Recorded so it is not looked for in the suite.
- **A remembered Voice naming a Provider this build does not have has never been on
  a screen** (added 08:45). `settingsForDocument` ignores it and
  `unusableVoiceSentence` says so, both asserted in `test/app/settings.test.ts`;
  what is unseen is the sentence rendered under the player. The same family as the
  three resume refusals above, and the same trick settles it: one Library file
  written by hand with a Voice from a Provider that does not exist here, one open.
  *Cost:* minutes, inside any device session.
- **The failure sentence has only been seen at the end of a document** (08:40). Its
  other branch — Utterances refused while sections are still to render, where the
  reading is left running and waiting — is asserted in `test/app/segment.test.ts`
  and has never been drawn. *Would establish it:* the same broken `fetch`, a seek
  into the middle of the owner's novel rather than the end of the fixture. *Cost:*
  one device session, and the harness for it is the one 08:45 describes.
- **Whether *Piper – Neural TTS*'s system-wide voices emit word markers** — item 6
  above. *Would establish it:* install it on a real device and ask
  `AVSpeechSynthesizer` for its voices and their markers. *Cost:* an hour, and if
  the answer is yes it is free offline neural voices with Word Timings.

### Needs neither the device nor hardware, and nobody has done it

- ~~**The CFI round-trip against Zotero, both directions**~~ — item 3 above,
  settled 2026-09-21 (`NOTES_2026-09-21.md`, 17:11). It cost the bounded
  afternoon predicted: 34 minutes of a delegated agent, four books, live.
- **Sentence-splitting quality on real books** — item 7 above. What is being judged
  is the polyfill's output rather than the platform's, and it is the first
  segmenter, not the final one. *Would establish it:* run the plugin's
  `test/fixtures/` cases plus a chapter of the owner's own book and read the output.
  *Cost:* an afternoon, all in Node.
- **Android's `MediaSession` half is not written**, and deliberately — there is no
  Android device and no emulator on this machine, so a path written here would be a
  path that has never run (ADR 0016). *Would establish it:* an emulator. *Cost:* a
  day, and it is a feature rather than a proof.
- **One unexplained import-boundary test failure** (2026-09-19 11:59), once, during a
  concurrent Xcode build, never reproduced. The suite now asserts that the lint
  override resolves, so a recurrence names its cause. *Would establish it:* nothing
  to do but leave the assertion in place.
- **Project-level iOS deployment configs stay at 16.4** while the app target is at
  17.2, so a target added later — a widget, a share extension — would inherit 16.4
  (2026-09-19 11:59). No such target exists, so the consequence is predicted.
  *Would establish it:* add one and watch it, or read the generated `pbxproj`.
  *Cost:* minutes, but only worth spending when a second target is wanted.

### Argued rather than asserted, and the argument is the right answer

- **Pausing from the lock screen re-opens the player** and **the player floats rather
  than pushing** were listed at 01:45 as not asserted. The first is asserted now
  (`test/now-playing/module.test.ts`); the second is a style whose evidence is the
  01:11 measurement — not a pixel moved, either way — and an assertion on it would
  restate the stylesheet.
- **The stepper's hold cadence** is three constants (01:15); an assertion on them
  restates them.
- **The identity cleanup now paints the highlight rather than clearing it**
  (ADR 0025), and on the **unmount** path that message goes into a WebView that is
  being torn down. Four Reader unmounts in the 08:23–08:45 session produced no
  warning, no error and no log line of any kind — but `clear()` was the same kind of
  call in the same place and had never been observed either, so what this rests on
  is that the two are the same `injectJavascript` and one of them has now been
  watched. An assertion on it would restate the bridge.
- **The lock screen is published while the cursor exists, which now survives an
  engine rebuild** (ADR 0025). Nothing appears until the audio session is active,
  measured at 04:05, and a press arrives at `reading.play()`, which builds the
  engine — so the window publishes an item iOS does not show. Argued from that
  measurement rather than re-observed across a rebuild.
- **`goToSection`'s already-rendered branch** was listed at 01:45 as neither proved
  nor asserted. It ran at 05:54, after eighteen minutes of reading made the state
  reachable.
- **The hit-test box guard can only ever be structural** (01:00, 01:45). It needs a
  hit-test, a layout and a box, all of which live in Safari, and `test/README.md`
  forbids a mock. The suite holds a tripwire over four properties of the line; the
  proof is the log, taken twice, with and without it. Calling the tripwire a proof
  is the one thing not to do.
- **ADR 0020's timing overrun is bounded rather than accumulating.** One measurement
  at 1.00× is argued to settle 1.50× and 3.00×, because `scaleTimings` and
  `heardSeconds` divide by the *same* clamped rate — and that identity is asserted
  in `test/playback/rate.test.ts`, which is what makes the argument a short one
  rather than a hope.
