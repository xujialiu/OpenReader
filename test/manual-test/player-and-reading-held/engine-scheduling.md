# The playback engine's guards on the simulator: starvation, rate changes, seeks during decode

Issues #157, #169, #158, #181, verified 2026-10-13 on `openreader-pb8`
(`6050C42A-2798-4063-8757-43A2BEBF5E1A`, iPhone 18 Pro, iOS 27.0), tree
`.worktrees/ios-playback` at d983b3d + e85b889 (test-only commit eb36be0 and
corrections after), app `1.0.0 (8)-beta8` (Settings line
`1.0.0 (8)-beta8-debug`), Metro on 8123 from that worktree, and the fake
Kokoro/OpenAI-compatible provider (`fake-kokoro.cjs`, served from a `/tmp`
copy with extra voice ids) at `127.0.0.1:8891` with
`OPENREADER_FAKE_TTS_SECONDS=0.4` and `OPENREADER_FAKE_TTS_DELAY_MS=1200` —
every Clip 0.4 s long and arriving 1.2 s after it was asked for. Document:
`issue86-fixture.ts`, five chapters of three named sentences, 40 Utterances,
NCX contents. Speed through the harness `rate` command; state through the
harness `say`/`seek`/`play`/`pause` and the Debug Log; the fake provider's
request log as the fetch-side evidence.

The engine changes under test are commit **d983b3d** itself (diff
75f3989..d983b3d): advance the read-ahead cursor when the playing queue turns
empty→non-empty; validate `last.bufferId` against the front on `setRate`;
coalesce `drain` requests while an async enqueue is pending and replay one
after the guard releases. e85b889 keeps #181's mutation guards in their own
functions (Node-only; `footguns.test.ts`).

**Timed against untimed.** The fake serves two routes: Kokoro's
`/dev/captioned_speech` (silent PCM **with word timestamps**) and the
OpenAI-compatible `/v1/audio/speech` (raw PCM, **no timings**). The Kokoro
runs below are **timed controls**: they show the engine crossing empty queues
under late fetches with word-timed Clips, which is not #157's shape. The
#157 evidence is the **compatible-provider run**, whose Clips carry no Word
Timings — the app's own line says so (`highlight="This Clip came with no
Word Timings, so the whole Utterance is highlighted. Nothing is estimated
(ADR 0005)."`, `reportsWordTimings=false`, `level=utterance`).

## What was measured (all pass)

- **#157, short late *untimed* Clips at 3× continue past four Utterances** —
  provider `compatible` (OpenAI-compatible `/v1/audio/speech`), voice
  `af_bella`, 12:47:39–12:48:05: all 40 requests `route=speech`, status
  `level=utterance` throughout with `reportsWordTimings=false`, the reading
  walked utterance 0 → 1 → 3 → 5 → … → 39, crossed all five sections, and
  stopped itself at the end ("That was the last of this document") after
  ~26 s. With every Clip a cache miss, the 1.2 s late fetches repeatedly
  emptied the queue; the read-ahead kept advancing (the defect's shape — a
  late Clip cueing the page without moving the cursor — stalls the window
  after the first four Utterances). Untimed `af_gale` and `af_fern` runs the
  same afternoon reached the end the same way.
- **Timed controls (Kokoro `/dev/captioned_speech`, word timings)** —
  `af_bella` 12:19:20–12:19:56 and `af_copper` 12:26:16–12:26:40, each all 40
  Utterances to the end at 3× with `level=word`. Same empty-queue traversal
  with timed Clips; not a reproduction of #157's untimed shape.
- **#169, a rate change cannot re-cue an old sentence — asserted on the
  app's own state, not the provider log.** `say` immediately before and
  after each change:
  - *Mid-play, mid-starvation (untimed, streaming)*: `af_fern`, rate 3→1.25
    at 12:56:07.250 with the reading at utterance 25/26. Before:
    `line="Reading Utterance 26 of 40, highlighting the whole Utterance."`,
    `playing=true utterance=25`. After: `line="Reading Utterance 27 of
    40…"`, `playing=true utterance=26` — the reading continued forward;
    speak deliveries then monotonic (30 at 12:56:09.989, 35 at 12:56:13.781,
    end 39); the engine's next trace carries `rate=1.25`.
  - *On a refusal stop (untimed)*: `af_hale`, `{"refuseFrom":2}` refused the
    second `/v1/audio/speech` request; the reading stopped at
    `line="Paused at Utterance 1 of 40."` with the Provider's message as the
    note (`playing=false utterance=0`, 12:59:09). `rate 1.25` at 12:59:33.5
    while stopped; `say` after: the **same line** ("Paused at Utterance 1 of
    40."), the same note, `playing=false`, and the provider's request count
    unchanged — no re-cue, no re-fetch. Lifting the refusal and pressing
    Play re-asked the refused Utterance (#45): requests resumed and playback
    ran 0 → 5 → 11 at 1.25× before the bounded pause.
  - The provider-log ordering agrees (no request for an Utterance behind the
    front after any change), but the assertion above stands on the app's
    `say`/`line=`/engine-trace state, which a cache-hit rate change would
    also exercise: a cached-Clip rate change produces no request at all, and
    the app state is what shows no re-cue.
- **#158, offline skips over natively encoded audio** — three chapters
  (First, Second, Third) downloaded through the app's own offline runtime
  (`download-chapter.cjs`, `state":"done"`, 370,470 bytes); on iOS the store
  holds **ALAC in m4a** (`src/offline/audio-files.ts`, `format: "alac"`),
  i.e. genuinely encoded audio that `decodeAudioData` must decode. The app
  was relaunched (memory Clip cache empty), the fake provider was **stopped**
  (port 8891 unbound), and the reading played at 3× from 12:52:28: the
  skipped seeks 3/5/7 at 12:52:31.7–33.3 each replaced the source
  (`graph=1 source=1/2/3 event=source.clear`) and the reading continued
  through 30 Utterances of downloaded audio with **zero successful network
  requests**, then stopped exactly at the first non-downloaded Utterance
  (30, "The Fourth Chapter") with `SynthesisError(network)` — the failed
  `POST /v1/audio/speech` lines name the boundary. Playback served from the
  saved store is also the runtime's own order: `synthesize` checks
  `savedClip` before the memory cache and the network
  (`src/offline/runtime.ts`).
- **#181** — Node-only (mutation guards on `onBufferEnded`, `seek`, `play`);
  `test/playback/footguns.test.ts` in the suite run below. Nothing to touch
  on a device.

## What the #158 run does and does not establish

The run shows the seek/skip boundary behaving with real natively encoded
(ALAC) clips in the loop: skips land, the reading resumes from the target,
no stale cue. It does **not** pin the held-decoder race: at 3× against local
files the decode of a 0.4 s clip is far quicker than playback, so a seek
landing inside a pending `decodeAudioData` — the exact interleaving — was
not demonstrated, and no native pending state was directly evidenced. That
race remains the Node double's (`test/app/reading-seek-during-decode.test.ts`),
which holds the native decode/session promises and asserts the generation
scheduling; the device run is boundary smoke, not a reproduction.

## Controls run along the way

- A refusal mid-reading stops the Reading with the Provider's message as the
  note and playback stopped (untimed compatible: 12:59:01; timed Kokoro:
  12:28:51, `note="Kokoro speech returned 500"`).
- A seek while paused moves the page and starts nothing (12:31 run).
- Reaching the end announces "That was the last of this document" and stops
  (five times, five voices).
- The consent gate held the first Play of a fresh provider setup for three
  minutes until the alert was answered (answering it is in the Pitfalls;
  pre-seeding `settings.consent` prevents a *future* question but does not
  resolve one already on screen).

## The suite behind it

Targeted regressions on this tree — `npx vitest run
test/playback/engine-starvation.test.ts test/playback/engine-rate.test.ts
test/app/reading-seek-during-decode.test.ts test/playback/footguns.test.ts
test/app-config.test.ts` — **5 files, 88 tests, all passing** (saved raw
output: `/tmp/or-pb8/vitest-targeted.log`). A first full-suite run under
heavy machine load (pod install and simulator boot in parallel) failed one
timing test (`test/core/providers/fish.test.ts`, saved:
`/tmp/or-pb8/vitest-full.log`, `1 failed | 2550 passed`); that file passes
alone and the quiet full re-run passed 165/2551, but that rerun's output was
not retained at the time — the saved artefacts are the targeted run and the
failed first run.

## What this cannot prove

- Native audio fidelity and exact timing: the fake provider serves silence,
  and the assertions read the app's state lines and the provider's request
  log, not the sound. The deterministic races (the empty-queue cursor
  advance, the `setRate` ownership check, the coalesced drain replay) are
  held by the Node doubles; this run shows the real native decode, session
  and queue boundary behaving the same way, which is smoke, not a proof of
  either race's internals — the #158 held-decoder race in particular was
  not reproduced on the device (see its section above).
- The 12:56 rate change was timed from outside the app (~1.5 s resolution);
  a change landing within one Clip of a section boundary was not aimed for
  on the device — the boundary case is the Node test's.
- Word-highlight fidelity (`level=utterance` here by design; `level=word`
  seen on the timed controls) was not measured against the voice.
