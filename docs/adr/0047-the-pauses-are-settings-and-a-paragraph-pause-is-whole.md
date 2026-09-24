---
status: accepted
---

# The two pauses are app settings, and a paragraph's pause is whole

_The product argument is [design 0047](../design/0047-the-pauses-between-sentences-and-paragraphs-are-yours.md).
Issue #60. The plugin's side is xujialiu/Zotero-TTS#142._

## What was done

- `AppSettings.pauses` is a `GapSettings` (`{ sentenceMs, paragraphMs }`,
  milliseconds at Natural Pace) and defaults to `DEFAULT_GAP`, 0 and 200.
  `parseSettings` keeps a value only if it is on its list:
  `SENTENCE_PAUSES_MS` is 0, 50, 100, 150, 200, 300, 400, 500, 750, 1000, and
  `PARAGRAPH_PAUSES_MS` is 0, 100, 200, 300, 400, 500, 750, 1000, 1500, 2000.
  Anything else, including a missing key, reads as the default. The app is
  unreleased, so nothing is migrated.
- `gapContentSeconds` returns `paragraphMs` where `startsNewBlock` says the next
  Utterance begins a Block, which includes the end of the document, and
  `sentenceMs` everywhere else, clamped at 0. It used to return
  `sentenceMs + paragraphMs` there. A `paragraphMs` below `sentenceMs` is
  returned as it is.
- `use-reading.ts` passes `gap: settings.pauses` to `createPlaybackEngine`.
  That option existed from the start but was never passed, so `DEFAULT_GAP`
  always applied. The pauses are **not** in `engineIdentity`, and the engine
  has no `setGap`.
- General has two `ValueRow`s in a card titled `Reading aloud`. The bracket rows
  moved to a card without a title below it and kept their footnote. `Choice`
  and the two menus are generic over `string | number`, and `Choice.icon` is
  optional. A pause's `Toggle` has no `systemImage`, and its label is `300 ms`.

## The facts it was built on

- **The engine reads the pauses once.** `createPlaybackEngine` takes
  `const gap = deps.gap ?? DEFAULT_GAP` at construction. Each Clip's gap is
  written into its buffer when it is queued (`AudioGraph.enqueue` appends
  `framesFor(gapSeconds, hz)` frames of silence). Up to
  `READ_AHEAD_UTTERANCES` (3) Utterances beyond the current one are already
  queued at any time, so changing the pauses during a reading would mean
  truncating and re-queueing those buffers. The rate needs none of that,
  because it is a parameter of the graph.
- **No reader is mounted while the pauses can change.** Settings is pushed only
  from the Library's header (`library-screen.tsx`), and General only from
  Settings. The Reader is a sibling route of Settings under the Library, and
  nothing navigates from the Reader to Settings. Opening Settings therefore
  pops the Reader first, and unmounting it runs `disposeEngine`. The next
  engine is built with the new values, so a read at construction is enough.
  The walkthrough harness can push General over an open reader
  (`{"do":"go","route":"General"}`, `test/manual-test/README.md`, which says
  "The UI never puts General over an open reader"). A pause chosen that way
  applies only from the next engine build.
- **Offline Narration saves no pause.** The silence is appended when a Clip is
  queued for playback. Nothing under `src/offline/` refers to the gap, so a
  downloaded chapter plays a new pause without being downloaded again. That is
  why the bracket footnote, which says the opposite about brackets, is not
  under the pause rows.
- **The pauses follow the speed.** The gap is content time and goes through
  the same time-stretch as the speech (`gap.ts`, ADR 0009). The plugin divides
  by the speed by hand to get the same result.
- **Voices differ in their own pause** (#61, `notes/NOTES_2026-09-24.md`,
  14:10 and 14:13). Asked one sentence at a time, the medians of the silence
  between consecutive Clips were Azure 0.42 s, Fish 0.12 s, Speechify 0.45 s
  and Kokoro 0.42 s. Fish's Clips are trimmed to within about 0.1 s at each
  end. Azure padded two two-word Clips to 1.82 s, which leaves about a second of
  silence after each.
- **A target pause length would need a threshold per voice.** Fish's narrator
  has noise near −37 dB that hides its pauses at −40 dB. Each threshold in #61
  had to be checked against that Provider's Word Timings. Speechify's and
  Kokoro's timings leave no gap between words, so their pause lies inside a
  word. Trimming a Clip's leading silence would also shift every Word Timing in
  it.
- **The plugin, at Zotero-TTS `205aeab`.** `readAloud.sentenceDelayEnabled` /
  `sentenceDelayMs` (true, 0) and `readAloud.paragraphDelayEnabled` /
  `paragraphDelayMs` (true, 200). Values are integer ms at 1×, clamped to
  0..5000 with an input step of 50, one pair for every voice. `gap.ts:57-67`
  returns `Math.round(sentence + paragraph)`. A switch that is off falls back
  to Zotero's value, which does not scale with speed: the voice's catalog
  `sentenceDelay` (300 on Premium Voice 1-3) or a flat 200 at a paragraph. The
  labels are `Pause between sentences` and `Extra pause between paragraphs`.
  The values travel only in `zotero-tts-shared-settings.json` and the
  per-machine backups, and OpenReader reads neither.

## Consequences

- Until Zotero-TTS#142 is done, the plugin and the phone agree on the
  paragraph pause only while the sentence pause is 0.
- The pauses are device-local. Carrying them would mean reading the plugin's
  shared-settings file, which is its own feature.
- A pause change takes effect at the next engine build. If Settings ever
  becomes reachable over a mounted Reader, the pauses need a live path (a
  `setGap` that re-queues what is queued) or a place in `engineIdentity`,
  which would re-spend synthesis.
- `UNSPEAKABLE_MS` (300) stays fixed. It is a beat for text that is not
  Speakable, not one of the two pauses.

## Alternatives

- **A pair per Provider or per Voice**, which would fit Fish without
  lengthening Azure's pause. Turned down to keep one number meaning the same
  on both devices.
- **A target pause length**, trimming or padding each Clip's own silence. See
  the thresholds above.
- **A live `setGap` with the rows in the reader's actions drawer.** It needs a
  truncate-and-requeue path for a setting that is chosen once.
- **The plugin's additive paragraph pause**, raising the paragraph pause to at
  least the sentence pause, or offering only paragraph values at or above it.
  See design 0047.
- **A number field or a stepper.** The system menu is one tap and has no
  keyboard (ADR 0035).
