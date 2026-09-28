# Voices, providers and what is sent

## Voice lists at start (#24)

`VoiceListProbe.swift`: a cold launch, about five
seconds, a real tap on `Stat Line Fixture` (below), a tap on `Choose a Voice`,
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

### The sheet while it is still asking (`voice-sheet-loading.cjs`)

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

## Short lines, brackets and the Fish language hint (#23, #25)

`stat-line-fixture.ts` writes `Stat Line Fixture.epub`: one chapter, no
heading, six paragraphs that are six Utterances — `100 exp`, `2/50 HP`,
`You gained 100 exp.`, `He cast [Fireball] at the wolf.`, `[Level Up]`,
`If x < 5 and y > 3, stop.` Put it in `Documents/Inbox/` and send the harness's
`add`, as for the sized fixtures above.

```sh
npx tsx test/manual-test/fixtures/stat-line-fixture.ts /tmp/openreader-stat-lines
```

### What was sent, and where the highlight fell (`stop-on-word.cjs`)

With the fixture open and paused, the simulator silenced, and this worktree's
Metro writing to a file:

```sh
SHOTS_DIR=/tmp/openreader-shots-01 OPENREADER_METRO=http://127.0.0.1:PORT \
  node test/manual-test/voices-and-providers/stop-on-word.cjs SIMULATOR_UDID METRO_LOG Fireball 20
```

It sends the harness's `watchfetch` for `api.fish.audio`, installs a recorder
in the reader's WebView through the harness's `js` (every change of the
`openreader-utterance` and `openreader-word` highlights, every 40 ms), presses
Play through the debugger with an in-app watchdog at MAX_SECONDS, pauses as
soon as the chosen word is the word highlighted, and prints the highlight
changes and the request bodies (never headers). `SHOTS_DIR` also takes
screenshots while it plays. It checks the simulator's own volume first. A
handler probe for Play and Pause, not a touch test; the recorder reads what the
WebView painted.

Measured 2026-09-22 with Dax (`en/9fa4b7a1b67446b48208f2f5d4bcd8da`) and the
default bracket list, 7.12 s from Play to Pause: the request texts were
`[Speak in American English] 2/50 HP`, `[Speak in American English] 100 exp`
(the first two are in flight together, so their order in the log is not the
reading order), `You gained 100 exp.`, `He cast Fireball at the wolf.`,
`[Speak in American English] Level Up`, `If x < 5 and y > 3, stop.`; no
`GET /model/9fa4b7a1…` lookup, because the start-up listing held Dax. Word
highlights: `100`, `exp`; `2`, `50`, `HP`; `You`, `gained`, `100`, `exp`;
`He`, `cast`, `Fireball`, `at`, `the`, `wolf` — each the document's own word,
`Fireball` without its brackets, nothing for the hint. Read-ahead is three
Utterances, so the sixth request goes out while the third line is read. A
download (`BracketsProbe` below) sent the same six texts, in reading order.

If the first line fails with "cannot reach api.fish.audio … The network
connection was lost", see Pitfalls: play again, and do not count that run. The
script does not notice a reading that stopped by itself; it waits out
MAX_SECONDS with nothing playing (the first measured run waited 20 s after
the failure at about 8 s), so keep the cap near what the stop word needs.

### The bracket switch over an open reader, and the download it names (`BracketsProbe.swift`)

```sh
bash test/manual-test/kit/run-probe.sh BracketsProbe SIMULATOR_UDID /tmp/openreader-brackets-01 -only-testing:testDownloadStatLines
```

- `testDownloadStatLines`: a cold launch, the Library's `...`, Download, Select
  all, Download selected, and `1 chapters downloaded` within 90 s. Real Fish
  requests on the free model; no playback.
- `testFlipBracketSwitch`: attaches to the running app, which must already be
  on General. The UI never puts General over an open reader, so push it with
  the harness: `{"do":"go","route":"General"}` while the reader is open. It
  flips "Remove enclosing brackets when reading" once and goes back to the
  paused reader.
- `testReadDownloadCount`: attaches to an open reader and prints the Download
  drawer's count.

Check the offline store between them, read-only, from the host:
`sqlite3 "file:$D/Documents/offline-narration-v2/catalog.sqlite?mode=ro"`
with `SELECT * FROM state` (the `speech` row is the setting the keys answer
to), `SELECT ordinal, clip_key FROM memberships WHERE document=…` and
`SELECT key FROM clips WHERE document=…`. A key is the SHA-256 of the Speech
Text (`offline/catalog-keys.ts`), so it can be computed on the host with
`prepareSpeechText`.

Measured 2026-09-22: the download saved six clips under the Speech Text keys
(`He cast Fireball at the wolf.` as `8773e8c3…`, `Level Up` as `46cc8f36…`).
Switched off by touch: `speech` became `[false]` at once, those two
memberships became `57438442…` and `655001ea…` (the bracketed texts), the other
four stayed, and the drawer said `0 chapters downloaded` with the chapter at
`4 / 6`. Line 4 then went to Fish as `He cast [Fireball] at the wolf.` and the
highlight went `He`, `cast`, `at`, `the`, `wolf`, with nothing for the
swallowed word. Switched back on: `[true,"<> []"]`, the keys back, `1 chapters
downloaded`, and line 4 played from the saved audio with no request, `Fireball`
highlighted.

## Azure Speech: configuration, the voice sheet, and word-level highlighting (#39)

`AzureProviderProbe.swift`, through `kit/run-probe.sh` (the target scheme is
still `LockScreenProbe`; only the source file differs):

```sh
bash test/manual-test/kit/run-probe.sh AzureProviderProbe SIMULATOR_UDID /tmp/openreader-azure-provider-01 \
  -only-testing:testProvidersOrderAndAzureScreenControls
```

Prerequisites: the latest Debug app connected to Metro, the owner's Azure key
and region in two host-only files (never printed, logged, or checked in —
`chmod 600` them, one credential per line, and remove them when done):

```sh
printf '%s' "$AZURE_API_KEY" > /tmp/openreader-azure-key.txt
printf '%s' "$AZURE_REGION" > /tmp/openreader-azure-region.txt
chmod 600 /tmp/openreader-azure-key.txt /tmp/openreader-azure-region.txt
```

The methods, each its own `-only-testing` invocation and meant to run in this
order because later ones depend on state earlier ones leave (Azure enabled, a
voice chosen), the same division `OfflineFixProbe`'s methods use:

- `testProvidersOrderAndAzureScreenControls` — no credentials, free: the
  Providers list order (Azure between OpenAI Compatible and Speechify), the
  Settings version line, and the Azure screen's controls (Enable switch,
  masked API key field with Show/Hide, Region field, Test connection).
- `testAzureConnectionWordingsAndEnable` — free (voice-list checks or
  client-side format checks, no synthesis): a wrong key, a wrong region, an
  invalid region id, and an unreachable region each produce their own wording,
  then the real key and region succeed and Azure is left Enabled. Idempotent:
  `ensureAzureDisabled` unlocks the fields first regardless of what state the
  screen starts in.
- `testVoiceSheetShowsAzureAndChoosesEnglishVoice` — needs the English fixture
  in the Library. Opens the voice sheet, measures the time from tapping the
  Azure chip to the locale row appearing, dumps the full accessibility tree
  (for a host-side count of locale chips — grep it for
  `label: '[a-z]{2}(-[A-Za-z0-9]+)*'`, about 154 expected), checks zh-CN's
  `晓晓` and the `multilingual` group's `Ava Multilingual`/`晓晓 多语言`, swipes
  the locale row, and confirms a MAI voice sits under its own locale (en-US)
  next to a Neural one — then chooses Andrew and leaves the sheet.
- `testPlayEnglishAzureVoiceHighlightsWord` / `testChineseAzureVoiceHighlightsWord`
  — a real Play touch, three screenshots roughly 2.5 s apart (about 5 s of
  playback, enough to see the mark move), then a real Pause touch. Needs the
  Chinese fixture for the second one, with zh-CN → 晓晓 chosen first.
- `testMAIVoiceHighlightsWholeUtterance` — same shape, with `Ethan MAI-Voice-2`
  chosen first; the mark should cover a whole sentence, never a single word.
- `testBackgroundDuringAzureReading` — waits past the initial buffering (the
  `Pause` label exists, and is `busy`, before the first clip arrives — see
  the playback methods' own first screenshot) so the "before" capture shows
  real progress, then backgrounds the app for 30 s and returns. Measured
  2026-09-22: "before" had the heading of Chapter 1 marked (`Ethan
  MAI-Voice-2` highlights a whole Utterance); "after" had a sentence from the
  *start of Chapter 2* marked — several Utterances further, across a chapter
  boundary, entirely while backgrounded, with no red box and the transport
  still coherent.

None of these methods spends more than a handful of free voice-list requests;
the playback methods are real synthesis (Azure's free tier) and are the only
ones that cost characters — a few short sentences each.

What it does not establish: the exact RN facts in ADR 0037 that are not
visible from a touch or a screenshot — the WebSocket close reason's exact
text and code, and binary frames arriving as `ArrayBuffer`. The close reason
is measured with the two-`cdp.cjs`-call technique above; a successful,
audible play with a moving highlight is what stands for the `ArrayBuffer`
fact, since `azure-ws.ts`'s `parseBinaryFrame` throws on anything else and no
audio would have played at all.

## Sentence or paragraph requests (#61, `context-probe.ts`)

`context-probe.ts` compares asking a provider for one sentence at a time, as the app does, with asking for a whole paragraph in one request. It runs in Node through the app's own `createProvider`, `segmentBlocks` with `splitWithSentencex`, and `prepareSpeechText`, so both modes send exactly the text the app would. No simulator is involved. It reads credentials from `~/.secrets/openreader/zotero-tts-settings.json`, the desktop plugin's settings export, and `OUT` must be outside the repository, because it receives the owner's book text.

```sh
OUT=/path/outside/the/repo; B=~/Works/epub_books
npx tsx test/manual-test/voices-and-providers/context-probe.ts survey "$OUT" "$B/Shadow Slave/Shadow Slave 1-250.epub" …   # sentences per Block
npx tsx test/manual-test/voices-and-providers/context-probe.ts pick   "$OUT" "$B/…epub" …   # candidates.json; write paragraphs.json from it by hand
npx tsx test/manual-test/voices-and-providers/context-probe.ts run    "$OUT" azure fish speechify local   # audio/<provider>-<P>-{sentence,paragraph}.wav + .json
npx tsx test/manual-test/voices-and-providers/context-probe.ts analyze "$OUT" -40   # analysis-40.{txt,json}; run again at -30
npx tsx test/manual-test/voices-and-providers/context-probe.ts page   "$OUT"   # listen.html, a blind A/B page; open it locally
```

`paragraphs.json` is a list of `{ id, book, section, kind, utterances }`, the shape `pick` writes. Voices are the owner's own where a match exists (`VOICE_MATCH`); otherwise the first English voice is used. Each provider gets one warm-up `Hello.` first. The six paragraphs of 2026-09-24 came to about 2,300 characters per mode per provider.

What it measures: time from `synthesize` to its result (the first sentence against the whole paragraph), total duration, timed words, and the pause at each sentence boundary. The per-sentence pause is the trailing silence of one Clip plus the leading silence of the next. The whole-paragraph pause is the longest silence from the last word's start to the next sentence's first word's end, alongside the gap the timings leave. Results are in `notes/NOTES_2026-09-24.md`.

What it cannot show: latency from the phone's network (it runs from the Mac, through whatever proxy the Mac uses); how iOS's `decodeAudioData` treats Fish's MP3 padding (ffmpeg drops the encoder delay the LAME header declares); the Blocks the renderer would find where a book's stylesheet makes a block element inline; anything about OpenAI or OpenAI-compatible voices, which return no timings and were not configured. The listening page randomises A/B per pair in the browser and keeps the order and answers in that browser's `localStorage`, so clearing it draws new orders.

## The reader's sheets and the voice handover (`ReaderProbe.swift`, `voice-playback.cjs`)

With the latest Debug app connected to Metro and the existing fixture Document
`A Short Test of Reading Aloud` in the Library:

```sh
bash test/manual-test/kit/run-probe.sh ReaderProbe SIMULATOR_UDID /tmp/openreader-reader-01
```

This reuses the disposable XCTest project builder. It opens the Document if
needed, drags all four handles/title regions, checks that Voice and Speed have
no Done button, and checks a paused voice choice stays open when the fixture's
Sarah/Adrian rows are present. It never presses Play. Inspect exported screenshots
as well as assertions. It leaves the reader paused. The optional voice choice
check restores Sarah; use this on the fixture document, not the owner's reading.

For deterministic transport/handover checks, first silence the simulator with
`silence.sh set`, open the fixture Document, and open Voice once so its Fish list is loaded. Fish
must already be enabled with its key in the app. No credential is read by or
printed from the test script. The first eight list entries supply distinct
choices; an English fixture supplies the test text.

```sh
node test/manual-test/voices-and-providers/voice-playback.cjs SIMULATOR_UDID /tmp/openreader-reader-01
node test/manual-test/voices-and-providers/voice-playback.cjs SIMULATOR_UDID /tmp/openreader-touch-01 touch
```

The first command requires an existing screenshot directory. It replaces only
Fish synthesis responses in the running process with delayed silent WAVs and
word timestamps. The actual provider parser, native audio graph, reader clock,
React handlers and persistence callbacks run. Assertions cover initial loading,
pause before receipt without abort, same-Utterance word handover, latest choice
wins, failure rollback, next-Utterance fallback without timings, and pausing a
pending handover until the next Play. Each playback interval stops on its checked
transition, with an eight-second watchdog. It reports durations in milliseconds.
This is a handler probe, not a touch test or a test of live provider audio quality.

The `touch` command uses a **new** artifact directory. It installs a five-second
reply delay and runs `ReaderProbe` in its `loading` mode to press Play, inspect the
spinner, and physically tap it to pause before any reply arrives. It then checks
that audio still arrives and the app remains paused. Do not run loading mode by
itself: it depends on the fixture and watchdog installed by the outer script.

Both modes restore fetch, the original voice and speed, close the sheet and
pause in `finally`. They use Metro's existing CDP inspection approach; they add
no test hooks to production app code. Do not edit app code while a probe runs:
Fast Refresh can replace the state being inspected. Restart the app afterwards
to remove all temporary debugger globals and verify final delivery separately.

## Paused sentence seeking after background receipt

With the same silenced simulator, fixture Document and loaded Fish list as above:

```sh
mkdir -p /tmp/openreader-paused-seek-01
node test/manual-test/voices-and-providers/voice-playback.cjs SIMULATOR_UDID /tmp/openreader-paused-seek-01 paused-seek
```

This mode pauses before the delayed silent audio arrives, waits for the native
queue, then sends text-tap messages for the current and next sentences through
the real reader bridge. It samples the actual WebView CSS highlights across two
300 ms fixture-word intervals: the sentence must remain highlighted with no word
range. Each Play must then highlight the selected sentence's first word, and
playback stops immediately after that observation, with the existing watchdog
and cleanup paths as backup. Screenshots are saved for both paused selections.

The temporary diagnostic receiver survives React updates and consumes only the
probe's responses; other renderer errors keep their normal reporting path.
Restart the app afterwards to discard all debugger state. This is a bridge-message
probe, not a physical touch test, live-provider audio test or long-term drift test.

## Fish regional picker, actual simulator touch

With Fish enabled and the fixture Document open, this opens Voice, physically
taps `en-IN` and asserts that `Aarav — Male Indian multilingual (EN)` appears:

```sh
bash test/manual-test/kit/run-probe.sh ReaderProbe SIMULATOR_UDID /tmp/openreader-fish-picker-01 --mode fish
```

It uses the live voice list, so it needs the configured app key and network.
It does not select a voice or start playback. It leaves the picker open and
captures the list for visual review. The source-toggle combinations are covered
by the provider tests; this mode verifies regional navigation and visibility.

## Fish narration interruption coverage (issue #73, `FishNarrationProbe.swift`)

Use the local Fish credential through `OfflineFixProbe` (`downloads/README.md`, Issues #13/#14) and ask the Fish voice list once before this probe. Open a long book from `~/Works/epub_books` in the Library, leave the reader paused, and run the probe with the simulator silenced:

```sh
bash test/manual-test/kit/silence.sh set SIMULATOR_UDID
bash test/manual-test/kit/run-probe.sh FishNarrationProbe SIMULATOR_UDID /tmp/openreader-fish-narration-probe \
  -only-testing:testRealFishPlayThenPause
```

Change `-only-testing` to run `testLookupPausesPreviouslyPlayingFish`, `testPauseOptionOffKeepsFishPlaying`, `testPronunciationInterruptionOnCurrentReader`, or `testPronunciationInterruptionResumeAndCancellation`. The last two use the real Fish audio path and require the pause option off; the second method changes it through Settings, while the current-reader method expects the already-prepared setting. `testPronunciationInterruptionResumeAndCancellation` also exercises close, restart, and changed-selection cancellation.

The real Fish run measured 2.3 seconds to active playback, continued for 5 seconds, and stopped with a real Pause touch. On a long book, the pause option off run kept the transport in Pause after closing lookup. With the player surface cleared through its real LogBox close touch, the interruption methods proved that pronunciation resumes narration that was playing, leaves already-paused narration paused, and cancels when the drawer closes or the selected word changes. Both pronunciation accents completed naturally, with no audio error, and all runs were made at zero simulator volume.

For the iOS handle-release regression, run `testSelectionHandleExpansionTranslatesSentence` to prepare the fixture, followed by `testPreparedHandleReleaseFinishesRequest`. The second method requires that the native selection changes and then reaches a result or bounded error. In beta35 it failed with `selecting=true`, `loading=false` after the DOM lost the handle's release. The native reader release bridge fixes that path. Its coordinates are measured on the dedicated iPhone 17 fixture; do not reuse them after a font/layout change without a screenshot check.
