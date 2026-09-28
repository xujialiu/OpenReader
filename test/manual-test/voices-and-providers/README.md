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


## Several sentences at once (#64, `download-concurrency.ts`)

`download-concurrency.ts` measures how fast a provider answers with one, two or more requests out at once. It goes through the app's own `createProvider`, `segmentBlocks` with `splitWithSentencex`, and `downloadSpeech`, so each request is exactly what a download sends. No simulator is involved. It reads the key from the settings export as `context-probe.ts` does (the two share `node-kit.ts`), and `OUT` must be outside the repository, because it receives the owner's book text.

```sh
OUT=/path/outside/the/repo; B=~/Works/epub_books
npx tsx test/manual-test/downloads/download-concurrency.ts "$OUT" "$B/My Vampire System/My Vampire System 1-250.epub" 1,4,2,8,5,6,10,3,1 40 20   # run.json, report.txt
npx tsx test/manual-test/downloads/download-concurrency.ts report "$OUT"   # the table again, from run.json
```

The arguments after the book are the levels in the order they run, the sentences per level, the first long section to take sentences from, and the provider (`fish` when left out). Running 1 first and last shows whether the service slowed down during the run. Every level sends different sentences. `fetch` is wrapped to record every exchange, a retried `429` included, with the `ratelimit-*` headers, and the clips are decoded with ffmpeg only after the timed part. Results of 2026-09-25 are in `notes/NOTES_2026-09-25.md`.

What it cannot show: the phone's own network, since it runs from the Mac through its proxy; the time the app spends saving each clip; how a provider other than Fish counts its limits, such as Azure's requests per minute (#40); whether Fish will enforce the limit it states.

### Timing a chapter download on the simulator

`download-chapter.cjs` prints `enqueued <ISO time>` as it hands the chapters to the runtime. Each saved clip is a file in `Documents/offline-narration-v2/<document>/<voice>/`, and the file's birth time is when the scheduler saved it, so the birth times time the download to the millisecond:

```sh
python3 -c 'import os,sys; d=sys.argv[1]; b=sorted(os.stat(os.path.join(d,f)).st_birthtime for f in os.listdir(d) if f.endswith((".audio",".m4a"))); print(len(b), b[0], b[-1])' VOICE_DIRECTORY
```

To compare with one request at a time: delete the chapters' audio through the runtime (`deleteDownloaded`, through `cdp.cjs`, then check that `occupied` reads 0), choose 1 in Settings › Providers › Fish Audio › Sentences at once (before beta26 this was `AT_ONCE` in `src/offline/scheduler.ts`), confirm that `settings.json` in the app container's `Documents` holds `"fish":1` under `sentencesAtOnce`, and download the same chapters again. Put it back to 5 afterwards. The number is read as each chapter starts, so change it only between downloads. Run the download with five at once first, so that anything the service remembers could only speed up the slower run. Configure Fish in the app first with `kit/run-probe.sh OfflineFixProbe … -only-testing:testConfigureFishProvider` (Pitfalls: before 2026-09-25 that method could pass with Fish still disabled).

### OpenAI Compatible's 422→MP3 fallback (#65) and Speechify's own queue, on the short fixture

`DownloadConcurrencyProbe.swift` also covers #65 (a PCM refusal falling back to
MP3) and confirms #64's Speechify `RequestQueue` change did not break plain
playback/download, both against the short two-chapter fixture rather than the
real book — a fresh voice directory each time, no pre-seeded state to manage:

```sh
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testConfigureCompatibleProviderRealTouches
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testChooseEmilyVoiceAndPlayShortFixture
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testCompatibleSentencesAtOnceFiveAndDownloadShortFixture
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testConfigureSpeechifyRealTouches
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testChooseSpeechifyVoiceRealTouches
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testSpeechifyDownloadAndPlayShortFixture
bash test/manual-test/kit/run-probe.sh DownloadConcurrencyProbe SIMULATOR_UDID OUTPUT_DIR -only-testing:testResetCompatibleSentencesAtOnceToDefault
```

Each method is its own invocation, run in the order above, the same discipline
as `AzureProviderProbe` and `OfflineFixProbe`: later methods depend on state
earlier ones leave (OpenAI Compatible configured and enabled, the short
fixture's voice chosen, Sentences at once at a particular value). The short
fixture needs adding first if it is not already in the Library (README, "Real
books"; the fixture is generated by `short-test-fixture.ts` and added through
the walkthrough harness's `add` command, which works for this one-shot use even
on a day the harness is otherwise unreliable for reading interactions).
OpenAI Compatible's Address/Model/Extra headers are read from
`/tmp/openreader-compat-{baseurl,model,headers}.txt` and Speechify's key from
`/tmp/openreader-speechify-key.txt`, the same host-only-file discipline as
`OfflineFixProbe.testConfigureFishProvider`. The last method resets OpenAI
Compatible's Sentences at once to its own default (1); Speechify's is never
changed from 1, and Fish's own default (5) is untouched by any of this.

What it cannot show: the app's MP3 decode path is only exercised end-to-end
through actual playback (item 2), not inspected directly; the OpenAI
Compatible connection check's own request shape is covered by this and by the
unit tests, not by inspecting wire bytes from the simulator.
