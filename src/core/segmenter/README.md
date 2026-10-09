# src/core/segmenter — ADR 0006

Turns the text of a **block** — a run of text the document presents as one unit,
a paragraph, a heading, a list item — into **utterances**, one sentence each.
The utterance is the unit sent to a provider, the unit of caching, of
prefetching and of resuming.

This does not exist in Zotero-OpenReader. A reader of that codebase would
reasonably assume it does; the plugin's own notes open by saying it does not.
Segmentation there is Zotero's, roughly 870 lines over a 7,600-line sentence
library plus a language detector carrying two megabytes of data.

## What we use instead, and why

**Upstream `sentencex`, directly.** Zotero's segmentation lives in the SDT
submodule, which has no licence file at all and is marked `"private": true` —
nothing grants permission to copy it. The algorithm underneath it is
third-party and freely usable, and what SDT adds on top is a document tree, page
mappings, source anchors and text ranges, which for EPUB are largely
unnecessary because epub.js already supplies a DOM.

**No language detector.** An EPUB declares its own `dc:language`, which removes
any need for `eld` and the two megabytes it carries. This is also why a document
with more than one language in it is not handled specially (ADR 0010): it is
read in its one voice, and detecting per sentence would mean reinstating exactly
what was avoided here.

`unicode-segmenter` is a dependency for the grapheme work that `Intl.Segmenter`
would otherwise do, and it is **required, not optional**: measured on Hermes
250829098.0.17 (the engine React Native 0.86.3 bundles), `Intl.Segmenter is not
a function`.

Import `graphemeSegments` from `unicode-segmenter/grapheme` — **not** from
`unicode-segmenter/intl-polyfill`, which an earlier draft of this file
recommended. That polyfill implements `granularity: 'grapheme'` and throws
`TypeError` for `'word'` and for `'sentence'`. Node's own `Intl.Segmenter` is
complete, so code written through the global passes every test here and throws
on the device; `engine-boundary.test.ts` fails if `Intl.Segmenter` is ever named
outside a comment. The consequence is that **no word boundaries exist on this
engine at all**, which is why a cut inside a sentence falls on whitespace or on
a grapheme cluster and never between words.

Both measurements are in notes/NOTES_2026-09-19.md, which is the record.

## The repair layer that is still needed

The plugin needed three repair layers over Zotero's segmenter. Choosing EPUB
first (ADR 0007) retires two of them — 457 lines putting back a page's first
line and 94 lines detecting equation source embedded at font size zero are both
PDF-only. The third is still needed: **rejoining a paragraph cut mid-sentence**,
154 lines.

## The test suite arrives before the code

The plugin's `test/fixtures/` directory holds real constructed cases for CJK,
Romanian diacritics, angle brackets and numbers. ADR 0006 is explicit that those
fixtures "are the accumulated record of where sentence splitting actually goes
wrong, and are worth more than the code". They come across as the test suite for
this directory.

notes/NOTES.md item 7 is still open in its substance: `Intl.Segmenter`'s
sentence quality on real books, measured against those fixtures. Half of it has
moved though — there is no `Intl.Segmenter` on Hermes to judge, so that
comparison is now against the polyfill rather than against the platform.
`sentencex` is the first segmenter here, not the final one.

## The consequence to keep in view

`sentencex` and SDT do **not** split text into the same utterances. So a reading
position can never identify its place by counting utterances — the two products
would count differently. That is what forces ADR 0008.

## Speakable

Text containing at least one letter or digit. Text that is not speakable is
never sent to a provider; it becomes silence. Not "valid", not "non-empty".

## What is here

```ts
segmentBlocks(blocks, language, { splitSentences, rejoin?, maxLength? }) → Utterance[]
segmentBlock(text, language, options) → Utterance[]   // one block, spans all `block: 0`
isSpeakable(text) → boolean
```

An `Utterance` is `{ text, spans, speakable }`. `text` is what a provider is
asked for and what a word timing's `charStart`/`charEnd` index into, trimmed of
whitespace at both ends so that a clip's cache identity — provider, voice and
text — does not distinguish `Hello. ` from `Hello.`.

Each span is `{ block, start, end, textOffset }`. `start` and `end` are
**UTF-16 code-unit offsets into that block's own text**, the convention
`core/align.ts` and `core/speech-text.ts` already use and the one a `Range` is
built from (ADR 0005), and the relation between a span and the text is exact:

```
text.slice(span.textOffset, span.textOffset + span.end - span.start)
  === blocks[span.block].text.slice(span.start, span.end)
```

So a word timing becomes a `Range` by finding the span that holds its offset,
subtracting `textOffset` and adding `start`. Almost every utterance has one
span; more than one means the repair layer put back a sentence the markup had
cut, and the highlight is one highlight over several ranges, which is what the
CSS Custom Highlight API takes. No offset is ever derived from a splitter's own
indices — see `sentences.ts`.

The splitter is a parameter, not an import. `sentences.ts` defines the seam,
`sentencex.ts` binds the pinned upstream release, and `index.ts` imports
neither, because ADR 0006 calls `sentencex` the first segmenter and not the
final one. `sentencex.ts` and `notes/NOTES_2026-09-19.md` carry why the pin is
where it is; `rejoin.ts` carries the argument for the repair layer and for each
of its refusals.
