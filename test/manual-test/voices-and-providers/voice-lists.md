# Voice lists at start (#24)

`VoiceListProbe.swift`: a cold launch, about five
seconds, a real tap on `Stat Line Fixture` ([stat-lines-and-brackets.md](stat-lines-and-brackets.md)), a tap on `Choose a Voice`,
and at once a locale chip (`en-US`) must be there and `Asking Fish Audio for
its Voices…` must not. It then chooses Dax from en-US with a touch, which while
paused is a preference and sends nothing, and closes the sheet.

```sh
bash test/manual-test/kit/run-probe.sh VoiceListProbe SIMULATOR_UDID /tmp/openreader-voice-list-01
```

Measured 2026-09-22 (iPhone 17, iOS 27.0, Fish only enabled): Library row at
6.2–6.4 s after launch, sheet opened at 9.5–9.7 s, listed, no "Asking…". With
`watchfetch` in `harness.json` before the launch, the only Fish requests of the
run were the start-up listing's (pages 2–4 of the official list are what the
log can show; see Pitfalls).

What it cannot tell: whether the list came from the start-up request or from
one the sheet sent itself, only that the sheet waited for none. The other half,
a sheet opened while the start-up listing is still out, is a harness sequence
rather than a touch, because a person cannot reach the sheet that fast: put
`{"seq":N,"do":"open","id":"sha256:…"}` in `harness.json`, launch, and as soon
as the reader's first `HX playing=` line appears send `{"do":"voicesheet","on":true}`
and then `{"do":"voicelist","provider":"fish","n":1}`. Measured 2026-09-22: the
sheet asked 4.3 s after launch, `voicelist fish n=null asking=true`, the sheet
said "Asking Fish Audio for its Voices…", and 5 s later `n=338 asking=false`
with no note. Fish's own session cache also shares an official listing that is
in flight, so a request count cannot show which layer joined; the unit tests in
`test/app/voice-lists.test.ts` are what hold the loader's joining.

## The sheet while it is still asking (`voice-sheet-loading.cjs`)

The harness sequence above as a script, so its timing does not depend on
someone watching the log:

```sh
VIDEO=1 node test/manual-test/voices-and-providers/voice-sheet-loading.cjs SIMULATOR_UDID METRO_LOG DOCUMENT_ID /tmp/openreader-sheet-loading-01 [SHOTS]
```

It cold-launches the app with `open` already in `harness.json`, sends
`voicesheet` as soon as the reader's first `HX playing=` line reaches METRO_LOG,
takes SHOTS screenshots (`loading-NN.png`, default 10), sends `voicelist` once
the sheet command has been read, waits for the listing to finish, photographs
the loaded sheet (`loaded.png`), closes the sheet and removes `harness.json`.
`VIDEO=1` also records `sheet.mp4`, from before the launch to the loaded sheet.
Needs this worktree's Metro writing to METRO_LOG, Fish enabled with its key and
the Document in the Library. Never plays.

Measured 2026-09-22 for #28 with `Stat Line Fixture`, in frames at rest (the
sheet's top edge at y = 1311 px): the title's first ink at x = 50 px, the Fish
Audio chip's edge at 48 px (16 pt), and "Asking Fish Audio for its Voices…" at
49 px, where the old build put it at 1 px against the screen edge. The extra
pixel is the A's own side bearing. Measure each row band by its leftmost pixel
that differs from the sheet's colour, `#1c1c21`, by more than 30 in any channel.

The contents sheet's note is on the short fixture: `shut`, `open` it, send `say`
until `spine=` is above 0, then `{"do":"contents","on":true}` shows "None of
these rows names a file in this book…". Measured the same day, its three lines
start at x = 51 px like the title (the old build: 3, 2 and 1 px) and end by
1135 px, inside the right inset at 1158. The 2026-09-20 `Contents-open`
attachment of a `ReaderProbe` run is the same sheet before #28. None of the
fixtures has no contents, or a marked row that is only approximate, so the
sheet's other two notes were not seen.

What it cannot show: a touch (the harness opens the sheet), or a loading state
the network did not give. Check the `voicelist` answers and the frames rather
than assuming the burst caught it.
