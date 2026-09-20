---
status: accepted
---

# The player rides the seek that already exists

The provider configuration UI, player eligibility and new-document voice default
are revised by [ADR 0026](0026-a-coherent-reading-interface.md). Historical
measurements below are retained unchanged.

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

## Built, 2026-09-20 — what the ADR did not know

Everything below this heading was added after the player was built and measured on
the device. Measurements are in `notes/NOTES_2026-09-20.md`; what is here is what
they forced.

### The hit-test snaps, so "no text node" is not a thing the platform will say

This ADR said "a tap that lands on no text node does nothing" and assumed the
hit-test would say so. **It does not.** `caretPositionFromPoint` — and
`caretRangeFromPoint` beside it — answers with *the nearest caret position*, not
with the position at the point. Measured: a click at (2.0, 23.4), inside the
body's own left padding and over no text at all, returned a text node in the
heading beside it and moved the reading to that heading's Utterance. At (1, 1) the
same, with `elementFromPoint` returning `HTML` and the heading's own box measured
at 33.5/21.4/368.5/59.4.

So the tap carries a second test: **the point must lie inside the box of the Block
it resolved to.** The Block's box rather than the character's, deliberately — a tap
between two lines of a paragraph, or past the end of a short last line, is inside
the paragraph and is an ordinary "read from about here"; a tap in the margin, or on
the empty page below the last paragraph, is inside nothing and does nothing. The
before/after pair is in the notes.

Both spellings of the hit-test are called, standard first. That is not a capability
check with a second behaviour behind it — they return the same node and the same
offset — and neither being present is reported rather than swallowed.

### What crosses, and in which direction

- `TapMessage` carries **a Block id and a code-unit offset into that Block**, never
  an Utterance: the WebView does not have the Utterance list. `cursor.ts`'s
  `utteranceAt` resolves it on the React Native side, which is where the rest of
  the coordinate chain already lives, and it is a pure function with tests.
- Its three answers, in order: the span that **contains** the offset (half-open,
  so a boundary belongs to the sentence it starts); otherwise the nearest span
  **ending at or before** it, which is the sentence a tapped space follows;
  otherwise the first span starting after it, for a Block's leading whitespace.
  Null anywhere else, and null means the bridge makes no call at all.
- The half-open end is only observable where two spans are **adjacent**, which is
  every sentence boundary in Chinese and none in English: `sentencex` trims the
  space between two English sentences and leaves a one-character gap between their
  spans. The test is Chinese for that reason.
- `DocumentMessage.hrefs` ships as specified. Measured on the device: **2,077
  hrefs** on the owner's book, beside `toc` of 15 top-level navigation entries.

### The overlay's height is a message, and it is not re-centred on arrival

`InsetMessage` carries the player's own measured height in CSS pixels, which are
React Native points because the library's template sets `initial-scale=1.0`.
`centre()` subtracts it from `clientHeight` and aims at the middle of what is left.

**Nothing is re-centred when the inset changes**, and that is the decision rather
than an omission: the player collapsing moves the middle of the visible text, and
scrolling to the new middle would move the text under the reader — the one thing
floating the player over the page exists to prevent. Measured: the spoken
Utterance's top stayed at **263.96 px** through expand → collapse → expand, not a
pixel either way. The new inset applies from the next Utterance.

Measured centring error after the change, read out of the registered `Highlight`'s
own ranges on the owner's book, `clientHeight` 758:

| player | inset | error vs the visible middle | error vs the container's middle |
| --- | --- | --- | --- |
| expanded | 267.67 | +0.090, +0.277, +0.065 px | −133.74, −133.56, −133.77 px |
| collapsed | 44.0 | +0.575, +0.766 px | −21.43, −21.23 px |

The baseline was 0.05–0.97 px over four Utterances (2026-09-19, 20:05). It is
preserved in both states. The right-hand column is half the inset, which is what
the sentence being spoken would have been pushed down by without the change.

One consequence of the message being lost is guarded: the player measures itself
before the WebView has finished loading, and `highlightCall` into a function that
does not exist yet is a silent no-op — so the bridge keeps the last inset and sends
it again when the document message says the program has installed.

The inset is the height of the **band** the player occupies, not of the area it
paints. Collapsed, the button sits at one end of a band that is mostly clear, and
the centring aims at a scalar; the error that costs is one button's height of extra
margin at the bottom, in the direction that keeps the spoken sentence visible.

### The debounce is guarded twice, and the second guard is the one that carries it

600 ms, Zotero's own number. Measured on the device: five presses of
previous-sentence produce **one** `engine.seek`, 612 ms later, while the highlight
moves on every press. With the debounce removed and nothing else changed, the same
five presses produce **five** seeks in 24 ms — five restarts and five synthesis
requests, four of them thrown away.

Removing only the `clearTimeout` still produced one seek, because the first timer
to fire takes the pending target and leaves null behind for the rest. Worth stating
so that neither half is removed as redundant: the timer keeps one call, the payload
keeps one target, and a caller that pressed five times has moved five sentences
because each press counts from the **pending** position rather than from where the
engine still is.

The highlight moving immediately is `bridge.show`: the same `SpeakMessage` the
clock sends, with `words: null` and a zero duration. The WebView's own loop starts
only when there are words, so nothing spins and nothing is estimated — the sentence
is lit whole until its Clip arrives and replaces it with the real timings.

### A contents tap is two steps, and the second one has a case the first misses

The page moves first and always; the reading follows when the section reports its
Blocks. Measured: a tap 496 chapters ahead put the page on spine item 500 and the
reading on Utterance 165 — that section's first — four seconds later.

The case that is not obvious: **a section that has already rendered reports nothing
again.** `blocks.ts` returns its index unchanged when a section's text has not
changed, so `onBlocks` never fires and a listener waiting for it would wait for
ever. So the first step asks whether the app already holds an Utterance for that
section and seeks now if it does; only an unrendered section is waited for. A
section that has reported and holds no text — a volume's title page, of which the
owner's book has thirteen — is finished with rather than waited for.

That second step also adopts the longer Utterance list **immediately** rather than
at the next Clip boundary, which is the one exception to the rule in
`use-reading.ts`'s `adopt`. The deferral exists so that a section arriving
mid-reading does not restart the sentence being spoken; here the owner has asked to
leave that sentence, and the Utterance being seeked to exists only in the new list.

### The voice list asks for everything but the Voice

`configuredProviders` lists a Provider when `missingBeforeVoice` is empty — which
is `readiness` without the Voice, including the model. A Provider that could list
its voices but not speak with them would be a trap: the picker offers it, the owner
picks, and Play stops on "OpenAI needs a model". Measured against the real Keychain
on the device: `["fish", "local"]`.

**`local` is offered on a first run, and that is the default address rather than an
accident.** `DEFAULT_SETTINGS.local.baseURL` is the local engine's own default, so
the one Provider needing no credential is configured out of the box; tapping it
says what the server said, which is the honest outcome when there is no server
there.

The Voice's **locale** is shown beside it only once that Provider's list has been
asked for. It is not a property of the id — three of the five Providers report no
locale at all — and fetching a list so that a caption could be complete would be
spending the owner's quota on a caption (philosophy rule 4). Lists are cached per
Provider for the session, because Speechify paginates and Fish merges up to three
sources.

### The stepper repeats by taking more steps, not by repeating faster

Every rate change re-sends the whole Word Timing array to the WebView
(`engine.setRate` → `cue` + `correct`), so a held button is a message cadence on
the bridge that ADR 0005 is about. The repeat is held at eight a second and the
**number of steps per repeat** grows instead — one for the first eight repeats,
then three — which is what `stepRate`'s count parameter exists for. Measured: one
tap is 1.50 → 1.55, and a hold of about 2.5 s is 1.50 → 3.15, with 1.50 → 3.00
inside the first two seconds.

### Where the player's own state lives

`collapsed` belongs to the reader screen, beside the two sheets' visibility, and
not to the player. The reason is decision 4: **pausing re-opens the player**, and
the pause is the screen's — a state inside the player would have to be told about a
pause that happened anywhere else. Measured through the button's own handler:
collapsed and paused → press → playing and still collapsed; press again → paused
and open.

The status line and the notes are **inside** the player, which the layout above
does not mention. Philosophy rule 1 is honest signals and a player that cannot say
whether it is highlighting the word or the sentence leaves the owner to guess at
the one thing this app is for; putting them in the player means collapsing hides
them with everything else, which is what collapsing is for.

### One more thing the engine had to be told

`build()` loads the engine at the Reading Position rather than at 0. A word tapped
or a chapter chosen **before Play was ever pressed** has already moved it, and
loading at 0 would silently read the book from its beginning instead.

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

## Where a paragraph begins, read off the spans

A paragraph is a Block, and the four skips are `src/playback/navigation.ts`: pure
functions over the Utterance list returning the index for `seek`. The rule they
need is "the Utterance that starts a paragraph", and it is **not** "the first
Utterance whose first span's Block differs from the one before it", because the
repair layer can weld a sentence across two Blocks (`segmenter/rejoin.ts`). It is:

> the first Utterance to speak any character of a Block — the one that begins in a
> Block the reading has not been in yet.

Which is already written, in `gap.ts`'s `startsNewBlock`, so `navigation.ts` calls
it instead of restating it. That is the load-bearing part: the extra 200 ms of
silence the reader *hears* at a paragraph and the Utterance the paragraph button
*lands on* are then one boundary rather than two sources of one fact.

The span invariant that makes it well defined: `blockRuns` partitions the Blocks
into contiguous ascending runs, `sentenceSpans` cuts each run's text into ordered
non-overlapping spans, and `spansIn` maps a span to the members it intersects in
ascending order — so across the whole list
`utterances[i].spans[0].block >= utterances[i - 1].spans[last].block`, with
equality exactly when the Utterance begins *inside* a Block whose first characters
an earlier Utterance already spoke. There is therefore no Utterance boundary at
that Block's start and nothing for a skip to seek to: the Block folds into the
paragraph the repair layer welded it to, which is the conclusion the repair layer
had already reached about the document.

One case the data cannot answer, recorded rather than guessed at. If a run's
Blocks were welded but no single Utterance spans the join — a `maxLength` cap
cutting at the inserted space, or a splitter that chose to end a sentence there —
the join leaves no trace in the spans at all, and both this and `gap.ts` read it as
an ordinary paragraph boundary. Nothing outside the segmenter's own tests passes
`maxLength` today, and the two agreeing is the property worth keeping either way.

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

## The contents list needs one more thing on the bridge, and it is the spine's hrefs

_Added with `src/core/document/contents.ts`. Measurements in
`notes/NOTES_2026-09-19.md`, the 23:19 entry._

A row's destination can only be a **spine index**, for `goToSection`. A navigation
entry is an `href`, and turning an href into an index needs the spine's own hrefs —
which `DocumentMessage` does not carry (`spine: number` and nothing else), and
which `RenderedSection.href` delivers one section at a time, far too late for a
list that opens before most sections have rendered. So the WebView must post the
spine's hrefs in spine order, once, beside the length it already posts.
`highlighter.ts` already reads one of them per section in `adopt`, so this is a
field, not a mechanism. Measured: 2,077 hrefs, **50,812 UTF-8 bytes** as a JSON
array. (The `toc` array on its own measures 241,468 bytes read out of `toc.ncx`.)

Nothing can mint a **CFI** for a row: a CFI is a path into a rendered document's
DOM. So there is no third currency, and `#fragment` is dropped — `part1.xhtml#ch3`
seeks to the top of `part1.xhtml`.

**The two hrefs are matched as strings, and that is safe for a stated reason.**
epub.js resolves neither the navigation's hrefs (`Navigation.ncxItem` returns the
raw `<content src>`) nor the spine's (the raw manifest href) against anything, and
they are relative to different files. Here `OEBPS/toc.ncx` sits beside
`OEBPS/content.opf` and the spellings are byte-identical. The lookup is epub.js's
own table from `Spine.append` — the href, `decodeURI` of it and `encodeURI` of it,
all three keyed to one index — with two deliberate differences: the **first**
occurrence of a repeated href wins, because the earlier item is the one in document
order and it keeps a row's target from going backwards as the list goes forwards;
and neither conversion may throw, where epub.js raises `URIError` out of `unpack`
and loses the whole book over one malformed escape. A book whose navigation lives
in another directory therefore resolves **every** row to null rather than one, which
is a state to report rather than a list of rows that quietly do nothing.

### Where the reading is, and the granularity that is actually available

Of the three ways the reading can be named — a Block id, a CFI, a spine index —
only the **spine index** connects to a navigation entry. The Block id carries it as
a decimal prefix (`highlighter.ts:334` mints `sectionIndex + '.' + ordinal`) and a
CFI's first component encodes the spine position, but both are second spellings of
a number `ReportedBlock.sectionIndex` already sends, and decoding the CFI would put
epub.js's CFI dialect inside `src/core/` — which is exactly what ADR 0008 keeps
out.

The rule: **the row whose spine item is the latest one at or before the reading's,
and the first such row in document order.** Written that way rather than "the last
row at or before the reading" because the two differ on a navigation not in spine
order, where the second returns whichever row happens to come last — an arbitrary
answer that reads like a considered one. On the owner's book the order never goes
backwards (0 decreases across 2,076 entries) and the two agree.

It resolves at spine-item granularity **and no finer**, so the answer carries how
coarse it is:

- `exact` — one row names the spine item the reading is in.
- `shared` — several do, and the **first** is reported. Rows sharing a spine item
  differ only by their fragment, a fragment names an element, and where an element
  falls needs the rendered document. Naming a later sibling while the reading is
  above it would be the confident wrong answer this ADR calls the expensive
  defect; the coarse answer that contains the reading is the right trade. The
  owner's book has **zero** fragments so this never arises there — and a book that
  puts a part's title and its chapters in one file is ordinary.
- `before` — no row names it, so the nearest row before it is reported. Happens on
  the owner's book exactly once: 2,077 spine items, 2,076 entries, and the one with
  no entry is spine item 1, `Text/copyright.xhtml`. Reading it reports the cover.

Two facts about the library's own data that the list must not trust. Its `Section`
type says `id: string`; `ncxItem` computes `getAttribute('id') || false`, so a
`navPoint` with no id yields the boolean `false`, and a navigation document's
`navItem` falls back to the href, so two entries in one file share an id. Nesting
therefore comes from `subitems` and never from `parent`, which is that same id. And
`toc.ncx`'s own `<meta name="dtb:depth" content="3"/>` says three levels where the
file has two, so the depth comes from walking the tree.

Flatten and locate on all 2,076 entries: **0.772 ms** and **0.003 ms** median under
Node on the desk — and two thirds of the flatten is building the spine table, not
walking the tree.

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

The floor is the one place the stepper is narrower than the engine: it stops at
0.50 while `MIN_PLAYBACK_RATE` stays 0.25, because a rate restored from a file or
synced from the desktop plugin is clamped by the engine and not by what a button
can reach. That is one limit with two audiences, not two limits.

**The step is walked on an integer grid, in hundredths.** 0.05 is not
representable in binary, so repeated addition accumulates: `1.7 + 0.05` is
`1.7500000000000002`, which no decimal literal denotes, is unequal to the `1.75` a
settings file holds, is displayed with sixteen digits, and is divided into every
Word Timing by `scaleTimings`. So the position is an integer, the arithmetic is on
the integer, and the rate is one division at the end — `n / 100` is a single
correctly-rounded operation on two exactly-representable integers and yields the
identical double to writing the literal. Seventy presses from 0.50 land exactly on
4.00, and every value in between satisfies `Number(v.toFixed(2)) === v`, which is
the test.

## Real Word Timings do not fit inside the audio, and the receiver is what clamps

Measured 2026-09-19 at 23:24, the first time this project's timing arithmetic was
run on timings a server actually produced (notes/NOTES_2026-09-19.md has the
tables). Three sentences per provider through the real `prepareClip`,
`scaleTimings`, `heardSeconds` and `engine.ts`'s `cue()`.

No real timing was out of order, overlapping, zero-length, or past the end of its
text. Two assumptions were wrong anyway:

- **Kokoro-FastAPI's last word ends 0.109–0.156 s past the end of the audio it
  sent**, on every clip, and its first word can start at −0.0068 s. The 19:05
  entry's proposed fix — drop the timing for a full stop, which is not Speakable —
  does not reach it: `core/align.ts` already folds a punctuation-only server word
  into the word before it, so the overrun now lives inside the last real word's
  `end`.
- **Fish Audio is the other way**, ending 0.194–0.281 s early on the same
  sentences, and leaves silences of up to **0.480 s between two timings** at a
  comma where Kokoro leaves none at all.

Neither is corrected in `playback/`. A Provider's number is the measurement, and
clamping one here is the estimate ADR 0005 forbids; `ClipCue` says so at the seam
instead, and the receiver holds its interpolation inside `[0, duration]` and treats
a gap between two timings as "the previous word stays lit". That is right for both
providers, where either provider's own shape would be wrong for the other.

It is also bounded rather than accumulating, which is why it is a caveat and not a
breach of PHILOSOPHY rule 2: `scaleTimings` divides the timing and `heardSeconds`
divides the duration by the *same* clamped rate, so the sign of the comparison
cannot change with the rate — only the magnitude, as `overshoot / rate`. One
measurement at 1.00× settles 1.50× and 3.00×, and the next `ClipCue` at the buffer
boundary re-anchors everything.
