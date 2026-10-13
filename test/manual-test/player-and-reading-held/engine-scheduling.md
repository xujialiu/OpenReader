# The playback engine's guards on the simulator: starvation, rate changes, seeks during decode

Issues #157, #169, #158, #181, verified 2026-10-13 on `openreader-pb8`
(`6050C42A-2798-4063-8757-43A2BEBF5E1A`, iPhone 18 Pro, iOS 27.0), tree
`.worktrees/ios-playback` at e85b889 (`1.0.0 (8)-beta8`, Settings line
`1.0.0 (8)-beta8-debug`), Metro on 8123 from that worktree, and the fake
Kokoro provider (`fake-kokoro.cjs`, served from a `/tmp` copy with extra voice
ids) at `127.0.0.1:8891` with `OPENREADER_FAKE_TTS_SECONDS=0.4` and
`OPENREADER_FAKE_TTS_DELAY_MS=1200` — every Clip 0.4 s long and arriving
1.2 s after it was asked for. Provider, voice and the fixture are the #86
ones: `issue86-fixture.ts`, five chapters of three named sentences, 40
Utterances, NCX contents. Playback speed through the harness `rate` command;
state through the harness `say`/`seek`/`play`/`pause` and the Debug Log; the
fake provider's request log as the fetch-side evidence.

The engine changes under test (d983b3d): advance the read-ahead cursor when
the playing queue turns empty→non-empty; validate `last.bufferId` against the
front on `setRate`; coalesce `drain` requests while an async enqueue is
pending and replay one after the guard releases. e85b889 keeps #181's
mutation guards in their own functions (Node-only; `footguns.test.ts`).

## What was measured (all pass)

- **#157, short late Clips at 3× continue past four Utterances** — twice to
  the end of the document. Voice `af_bella`, 12:19:20–12:19:56: with every
  Clip a cache miss at first play, the reading walked utterance 3 → 5 → 7 → 9
  → … → 39, crossed all five sections (the text-less Volume Two page read
  past), and stopped itself at the end ("That was the last of this
  document"). All 40 Utterances requested, one line each in the provider log,
  in ascending order. Voice `af_copper`, 12:26:16–12:26:40, same outcome
  (0 → 39, ~0.65 s an Utterance, the fetch latency gating each batch). The
  defect's shape — a late Clip cueing the page without advancing the cursor —
  would stall the fetch window after the first four Utterances; both runs
  passed utterance 4 within the first ~6 s and never stopped fetching.
- **#169, a rate change cannot re-cue an old sentence** — three device legs.
  - *Mid-play, mid-starvation*: at 12:26:31.744, with the reading playing at
    3× and utterance ≈ 23–25 on screen, `rate 1.25`. The provider log's
    requests continue strictly ascending (26, 27, … 39) — no request for any
    Utterance behind the front, and the status lines never step backwards.
  - *On a stopped Reading*: at 12:26:43 the reading had ended;
    `rate 2.5` produced no synthesis request at all and no cue (the engine's
    rate state took the value — the next trace line reads `rate=2.5` — and
    the Reading stayed stopped at the end).
  - *On a refusal stop*: `OPENREADER_FAKE_TTS_REFUSE` refused request 5
    onwards; the reading played to utterance 4 and stopped with
    `note="Kokoro speech returned 500"` (12:28:51). `rate 1.5` at 12:29:23
    while stopped: the request count did not move (no re-fetch, no re-cue of
    utterance 4), the status held `utterance=4` with the refusal's note.
    Removing the refuse file and pressing Play re-asked the refused
    Utterances (#45) and playback resumed from 4, reaching utterance 17
    within 9 s.
- **#158, seeks during pending decode land on the latest generation** —
  voice `af_eve` (every Clip uncached, 1.2 s away), 12:33:29: play at 0;
  seek 6 at :31.2, seek 8 at :32.0, seek 10 at :32.5 — each landing while the
  previous generation's Clips were still being fetched and decoded. The
  status line showed `utterance=6` after the first seek, `utterance=10` by
  :33.1, and playback then advanced monotonically 10 → 11 → 13 → … → 31 with
  no further action and no step back to an earlier generation's target.
  The engine's own lines show each seek replacing the source
  (`graph=4 source=6/7/8 event=source.clear`).
- **#181** — Node-only (mutation guards on `onBufferEnded`, `seek`, `play`);
  `test/playback/footguns.test.ts` in the suite run below. Nothing to touch
  on a device.

## Controls run along the way

- A refusal mid-reading stops the Reading with the Provider's message as the
  note and playback stopped (the #155 behaviour, re-seen on this build).
- A seek while paused moves the page and starts nothing (re-seen: the 12:31
  seeks landed after the reading had ended and started nothing).
- Reaching the end announces "That was the last of this document" and stops
  (three times, three voices).
- The consent gate held the first Play of a fresh provider setup with
  `playing=true` and no fetch for three minutes until the alert was answered
  (see the Pitfalls note on answering it; pre-seeding `settings.consent`
  does not resolve a question already on screen).

## The suite behind it

`npx vitest run` on this tree: 165 files, 2551 tests, all passing (a single
run under heavy machine load saw one `test/core/providers/fish.test.ts`
timing test fail; it passes alone and in the quiet re-run — load flake, not
a code defect).

## What this cannot prove

- Native audio fidelity and exact timing: the fake provider serves silence,
  and the assertions read the app's state lines and the provider's request
  log, not the sound. The deterministic races (the empty-queue cursor
  advance, the `setRate` ownership check, the coalesced drain replay) are
  held by the Node doubles in `test/playback/engine-starvation.test.ts`,
  `engine-rate.test.ts` and `test/app/reading-seek-during-decode.test.ts`;
  this run shows the real native decode, session and queue boundary behaving
  the same way, which is smoke, not a proof of either race's internals.
- The 12:26 rate change was timed from outside the app (~1.5 s resolution);
  a change landing within one Clip of a section boundary was not aimed for
  on the device — the boundary case is the Node test's.
- Word-highlight fidelity at 3× (`level=word` seen throughout) was not
  measured against the voice.
