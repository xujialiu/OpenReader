---
status: accepted
---

# Fish sends a language hint with a short Speech Text

_The product argument is
[design 0032](../design/0032-short-phrases-are-read-in-the-voices-language.md).
The rule is the desktop plugin's (xujialiu/Zotero-TTS#98, its
`src/core/fish-language-hint.ts`); this records how it came across a platform
that lacks what the plugin counts with, and what was measured on the way._

## The rule, unchanged

A Fish request whose Speech Text has one to three words is sent as
`[Speak in <name>] ` followed by the Speech Text; four words or more, or none,
are sent bare. Numbers count, punctuation and symbols do not. `<name>` is what
`Intl.DisplayNames(['en'], { type: 'language' })` calls the voice's locale after
`Intl.Locale` has canonicalized it, so Dax (`en-US`) gets "American English", an
English voice without a region "English", and `tl` "Filipino". No hint for
`mul`, for a locale with no name, for `Default`, or for `checkSynthesis`'s `Hi`
(the plugin leaves its samples bare the same way). No setting.

## Why the first port left it out, and why that no longer holds

`src/core/providers/README.md` recorded two reasons.

**`Intl.Segmenter` is not on Hermes** (notes/NOTES_2026-09-19.md, 12:21). The
plugin's helper, copied as it was, would return `''` on every call on the device
and pass every test under Node. That still holds, so the count is written by
hand (below) rather than ported.

**Fish might speak the hint**, pushing every timing late. Measured on
2026-09-21 at 23:45 (notes): neither `[Speak in American English]` nor
`[Speak in English]` is spoken. The hinted clips of `100 exp` and `2/50 HP` are
+0.29 s, +0.05 s, −0.05 s and −0.05 s against the bare ones, inside the
0.2–0.3 s the same bare text varies by between runs, where a spoken four- or
eight-syllable cue would add 0.6–1.5 s; the first word is timed at 0.00 s in
every reply; and neither the reply's `content` nor its word timings contain a
word of the hint. The plugin's own record agrees: the owner heard both hinted
stats read correctly (Zotero-TTS notes/NOTES_2026-09-13.md, 12:55).

## How it counts: `countWords` in `src/core/fish-language-hint.ts`

For text written with spaces it reproduces UAX #29 as `Intl.Segmenter` applies
it: runs of `\p{L}\p{M}\p{N}` and the connector `_`; a run continues through
MidLetter, MidNumLet or Single_Quote between two letters (`don't`, `e.g`, `a:b`,
`hello·world`) and through MidNum, MidNumLet or Single_Quote between two digits
(`3.14`, `1,000`, `1'000`, `1;2`); a letter and a digit side by side are one run
(`v1.2.3`), while `.` between a letter and a digit breaks (`a.1` is two). The
test runs 51 such samples against Node's `Intl.Segmenter` (ICU 78.2) and expects
the same count for each; the probe that found the rules is in
notes/NOTES_2026-09-22.md, 00:47.

For Han, Hiragana, Katakana, Hangul, Thai, Lao, Khmer and Myanmar it counts one
word per letter — a mark, or a modifier letter directly after one, adds nothing.
ICU finds words in those scripts by dictionary (`第一章`, `カタカナ`, `한국어`,
`สวัสดี` are one word each to it), and there is no dictionary here; the owner
chose per-character counting, which hints the same short headings and hints
fewer longer ones (`第十一章`: four here, one to ICU). Thai and the other
unspaced scripts are in the set so a whole unspaced sentence is not taken for
one word and hinted.

## How it names: a table, `src/core/language-names.ts`

Every two-letter code `Intl.DisplayNames` names, run through `Intl.Locale`
first, plus the fourteen English regions `fish.ts` files a voice under. A test
checks every entry against Node's `Intl.DisplayNames` and that no nameable
two-letter code is missing. A table rather than the call because it cannot fail
silently on the device: `Intl.DisplayNames` on Hermes was not measured, and the
segmenter is the precedent. Fish's library used 59 codes when listed on
2026-09-22 (notes, 00:30), every one two letters; a three-letter code gets no
hint, as a locale the plugin cannot name gets none.

## Where the locale comes from: `voiceLocale` in `fish.ts`

The published voice id is `<language>/<model id>` and never carries a region —
`fishVoice` keeps the prefix stable so a saved Voice resolves whatever its
labels say later. The region lives in the `VoiceInfo.locale` the listing
published. So, counted first so that a long sentence never waits:

- `Default` → `mul`, no hint;
- any prefix other than `en` and `mul` → the prefix, because `fishVoice` only
  ever adds a region to an English voice or an English-labelled multilingual one;
- `en` and `mul` → the session cache: the official and own listings' values and
  the pasted-id map, keyed by account. The app fills it at start (ADR 0033). A
  listing still in flight is awaited. Failing both, `sharedPastedRequest` asks
  `GET /model/{id}` once and remembers the answer.

A failed lookup propagates as the `SynthesisError` it is, so the utterance fails
and is retried like any other rather than being sent bare — and perhaps saved
into Offline Narration bare, under the same name as a hinted one.

## What did not change

`SynthesisOptions` stays `{ voice, signal }`: the hint is a function of the
voice and the Speech Text, both of which Fish already has. The clip's name stays
`(provider, voice, Speech Text)` (ADR 0028) for the same reason; the plugin had
to put its hint into the cache key because its locale came from Zotero's voice
object, outside the key. The stream's words are still aligned to the Speech Text
alone, and the note gains `, language hint [Speak in …]` for the debug line.

Two consequences are accepted. Audio saved before this change is found under the
same name and keeps its old reading until it is downloaded again (the owner had
downloaded none; the app is unreleased). And if Fish's metadata for a voice
changed its region, the same name would afterwards be spoken with a different
hint.

## Turned down

- **The id's language only** (`[Speak in English]` for every English voice): no
  lookup at all, but not the wording the owner tested.
- **The plugin's mechanism**, the app passing the locale in `SynthesisOptions`
  and the hint joining the clip's name: offline playback must name saved audio
  without a voice list in hand, so the name cannot depend on one.
- **`Intl.DisplayNames` at run time**, and a dictionary segmenter: the first is
  unmeasured on Hermes and would fail silently if absent; the second is a
  dependency for a count the owner accepted per character.
