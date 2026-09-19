---
status: proposed
---

# The player rides the seek that already exists

_The product argument is
`docs/design/0020-the-player-and-knowing-where-you-are.md`._

Six controls (tap-a-word, previous/next sentence, previous/next paragraph, the
contents list) are six ways of naming one Utterance. All of them end in the same
call, which is already written, already has the semantics they need, and has
never had a caller:

```ts
// src/playback/engine.ts:89
seek(utterance: number): void
```

Its implementation (`engine.ts:353-360`) is `restart(utterance); pump();` — the
queue is cleared, the clock re-anchored, and playback continues if it was
playing, deliberately without a `resume()`. `src/app/use-reading.ts` exposes
`{ bridge, status, opened, play, pause, readingPosition }` (`:107-127`) and never
reaches it. Exposing it is most of this ADR.

The only control that is not a seek is the speed, which is `engine`'s rate.

## Tap-to-seek, and why it cannot be a long press

A word is located the way a Word Timing already is: the tapped point hit-tests to
a text node, the enclosing Block's id and the offset within it give a span, and
`segmentBlocks`' span invariant maps that to an Utterance index. No new
coordinate system.

**It must be a tap, not a long press**, because a long press on text is iOS's
selection gesture and suppressing it means `user-select: none` — which silently
stops `::highlight()` from painting. That was bisected on the device under this
exact layout (`notes/NOTES_2026-09-19.md`, the 20:10 entry: `text` paints,
`none` draws nothing with the same Ranges registered, `text` paints again). So
text selection stays enabled and the long press belongs to the platform.

A tap that lands on no text node does nothing. It is explicitly **not** a
toggle for the player's visibility: see the design file.

## Previous paragraph diverges from Zotero, and this is the one place it does

Zotero's reader bundle (read from `/Applications/Zotero.app/Contents/Resources/
app/omni.ja` → `resource/reader/reader.js:39424-39438`) skips an extra paragraph
when the position is mid-paragraph, with the comment "so paragraphs are treated
as a single unit for skipping". Zotero-TTS is a pass-through and inherits it
(`src/core/shortcut-actions.ts:59-64`, `src/ui/read-aloud-shortcuts.ts:296-310`).

We do not. Previous-paragraph goes to the current paragraph's first Utterance
when the position is not already there, and to the previous paragraph's first
Utterance when it is. The reason is a duration asymmetry, not taste: a sentence
here is one to two seconds and a paragraph in the owner's novel runs to half a
minute, so Zotero's rule makes "read that paragraph again" unreachable in one
press while costing nothing at sentence granularity.

Copied from Zotero unchanged, each verified in its source:

- **No time threshold.** Previous-sentence is index − 1 however far into the
  current Utterance the clock is (`reader.js:39417-39439`, pure index arithmetic;
  the only thresholds nearby are the 5 s/20 s pause-resume backoff at
  `reader.js:40203-40212`, which is English-only and unrelated).
- **Sections are not boundaries.** Zotero's `_segments` is one document-wide
  array built from the materialised tree (`reader.js:84021`, `:84061`), so ±1
  crosses a spine item with no special case. Ours is the Utterance list, which
  has the same property.
- **Clamped at the document ends, and clamping re-speaks.** `_skipTo` stops and
  re-speaks unconditionally (`reader.js:39460-39470`), so previous-sentence at
  index 0 restarts index 0.
- **Paused navigation moves the highlight and does not resume**
  (`reader.js:39460-39470`; `_speakInternal` returns early while paused,
  `:40155-40172`).
- **Rapid presses coalesce.** Zotero debounces the fetch by 600 ms
  (`SKIP_DEBOUNCE_DELAY`, `reader.js:39904`, applied `:40222`) while moving the
  highlight immediately. We need the same, for the same reason: five taps must
  not be five synthesis requests.

Controls are never disabled at boundaries — Zotero's popup carries no `disabled`
prop on any of the five (`reader.js:38694-38740`), and the plugin's own player
disables them only when no session is open (`addon/content/player-controls.js:58`).

## The overlay moves the centring target

ADR 0011 centres the spoken Utterance against `rendition.manager.container`'s
`clientHeight`. The player floats over the bottom of that container, so the
visual centre of the _uncovered_ text is not the container's centre, and
`centre()` must subtract the covered height.

**This is a live coupling, not a note for later.** The covered height changes
when the player collapses to one button and when it expands, so the offset is an
input to the centring rather than a constant — and the centring runs once per
Utterance on the Clip cue, so a stale offset is not self-correcting. The
measured baseline to preserve: 0.05–0.97 px error over four Utterances on the
owner's book, and an Utterance taller than the viewport pins its top instead
(`notes/NOTES_2026-09-19.md`, 20:05).

## The contents list is already on the bridge

`@epubjs-react-native`'s template posts `onNavigationLoaded` with `item.toc`
(`lib/module/template.js:230-235`), `View.js:267-277` stores it, and `useReader()`
returns it typed `Section[]` of `{ id, href, label, parent?, subitems }`. Nothing
in `src/` references it: the renderer uses only the spine.

Measured on the owner's book (34,453,009 bytes, `仙逆 (耳根).epub`):

- EPUB **2.0**, no navigation document — `toc.ncx` only (412,498 bytes raw), which
  epub.js handles: `loadNavigation` prefers `navPath`, falls back to `ncxPath`,
  and a book with neither yields an **empty `Navigation` that resolves normally
  rather than an error**.
- **2,076 `navPoint`s, nested exactly two levels**: 15 top level (cover,
  introduction, 13 volumes), 2,061 chapters beneath. Volumes hold 54 to 343
  chapters.
- Labels are short: min 2, max 22, mean 10.7 characters.
- Serialised in the library's own shape: **262,240 UTF-8 bytes**. It already
  crosses at load, so the list costs nothing new.

Two levels and 2,076 rows is a sectioned list, not a drill-down: it must mount
scrolled to the current chapter with that row marked, because with the progress
bar gone this is the only thing that answers "where am I".

## Voices: the locale dimension is missing from half the providers

`VoiceInfo` is `{ id, label, locale }` with `MULTILINGUAL = 'mul'`
(`src/core/providers/types.ts:80-92`).

| Provider          | Voice list                                       | Locale                                              | Lists without a key?      |
| ----------------- | ------------------------------------------------ | --------------------------------------------------- | ------------------------- |
| `openai-official` | 11 hardcoded names (`openai.ts:18-30`)           | none, all `mul`                                     | **No**                    |
| `compatible`      | typed ids → server's `/v1/audio/voices` → the 11 | none, all `mul`                                     | Yes, but needs a base URL |
| `speechify`       | paginated fetch (`speechify.ts:369-386`)         | real, encoded `locale/id` (`:103`)                  | No (`:370`)               |
| `fish`            | up to three merged sources (`fish.ts:635-644`)   | real, from `languages` (`:271-275`)                 | No (`:761`)               |
| `local` (Kokoro)  | server's `/v1/audio/voices`                      | derived from a name prefix (`local/kokoro.ts:9-25`) | Yes, but needs a base URL |

**`openai-official` cannot list voices without a key, and the code's own comment
is misleading about why.** `listVoices` throws only on 401/403 and otherwise
falls through to the hardcoded names (`openai-compatible.ts:285-302`), and the
comment says "OpenAI itself answers 404" — which is true _with_ a valid key.
OpenAI authenticates before it routes. Measured 2026-09-19:

```
GET https://api.openai.com/v1/audio/voices   no Authorization   -> 401
GET https://api.openai.com/v1/audio/voices   invalid key        -> 401
```

So the fallback is unreachable unauthenticated, and the picker must treat
`openai-official` as key-requiring. The two that need no key need a base URL
instead, so the unconfigured reason is not one message but two.

Consequences for the picker: only configured providers appear at all (design
file); the locale level is a one-entry list reading "multilingual" where the
provider has no locale, so the picker's shape does not change per provider; and
voice lists are cached per provider rather than re-fetched per open, because
Speechify paginates and Fish merges up to three sources.

## Rate: expose what the engine already clamps to

`src/playback/rate.ts` sets `MAX_PLAYBACK_RATE = 4` because that is
`WsolaTimeStretcher::MAX_PLAYBACK_RATE` and the audio thread clamps to it, and
`MIN_PLAYBACK_RATE = 0.25` because below that `heardSeconds` turns a rounding
error into a visible offset. The clamp is load-bearing: a rate above 4 reaching
`scaleTimings` would play at 4× while the timings were divided by the larger
number, drifting the highlight by a constantly growing amount.

The stepper exposes **0.50 to 4.00 in steps of 0.05**, holding to repeat. It does
not invent a narrower product limit, because a second limit that disagrees with
`rate.ts` is a second thing to keep true. `READING_RATES` (`src/app/settings.ts:84`,
`[1, 1.5, 2, 2.5, 3]`) is replaced, and `rate.ts`'s comment that "the app's range
is 1.5–3×" is stale in two directions and goes with it.
