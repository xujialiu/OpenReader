---
status: accepted
---

# The sentence segmenter and the playback engine are new work

*The product argument — what this is for and what it gives up — is
`docs/design/0006-sentences-and-playback-are-built-from-scratch.md`.*

Neither exists in the Zotero-TTS plugin, and a reader of that codebase would
reasonably assume both do. The plugin's own notes open by saying so: "The native
player, sentence segmentation, prefetching, and word/sentence highlighting are
all Zotero's; the plugin only supplies voices and audio (plus word
timestamps)." Zotero's share of that is roughly 1,900 lines of player and 1,900
of playback engine — a controller reading three utterances ahead with two
concurrent fetches, a WSOLA time-stretch, an audio graph and a gap timer — plus
around 870 lines of segmentation over a 7,600-line sentence library and a
language detector with two megabytes of data.

These two components, not the provider layer, are the bulk of this project. They
will be written by adapting Zotero's own implementation, which is open source.

## The segmenter and the engine are borrowed differently

"Adapting Zotero's implementation" means something different for each of the
two, and the licences were checked rather than assumed:

- `zotero/reader`, which holds the player and playback engine, is **AGPLv3**,
  copyright Corporation for Digital Scholarship.
- `zotero/structured-document-text` — the SDT submodule, where
  `buildSDTReadAloudSegments` and therefore the segmentation actually lives —
  has **no licence file at all** and is marked `"private": true`. Nothing grants
  permission to copy it.
- The sentence-splitting algorithm Zotero's segmentation is built on is
  third-party: `sentencex`, plus the `eld` language detector, each under its own
  licence and usable directly from upstream.

So:

**The segmenter uses upstream `sentencex` directly — pinned to 0.4.2.** The
version matters and the pin is not tidiness: from 1.0.0 the package is a binding
to a Rust library, `require('sentencex-' + process.platform + '-' + process.arch)`
resolving a native `.node` addon, with binaries for darwin, linux and win32 and
none for a phone. Hermes cannot load one and Metro cannot bundle one, so the
releases this sentence would otherwise point at cannot run in the app at all.
0.4.2 is the last JavaScript release, MIT, and what it costs against 1.0.31 —
thirty languages rather than the full set, and a handful of abbreviation cases
each way — is measured in notes/NOTES_2026-09-19.md. The decision below is
unaffected by which release loads; that is why the answer was to pin rather than
to port the algorithm, which would have re-opened it. What SDT adds on top of it
is a document tree, page mappings, source anchors and text ranges — and for EPUB
those are largely unnecessary, because epub.js already supplies a DOM. The part
actually missing is splitting a run of text into sentences, and that part is
third-party and freely usable. Language detection is avoided too: an EPUB
declares its own `dc:language`, which removes any need for `eld` and the two
megabytes of data it carries.

**The playback engine is read and then written fresh.** Its value is in the
behaviour — three utterances of read-ahead, two concurrent fetches, a
pitch-preserving time-stretch, a gap timer — not in the lines of code, and the
lines are AGPL. Learning the behaviour from an AGPL implementation and writing
our own keeps this project's licence free.

## Consequences

Choosing EPUB first (ADR 0007) is what makes this tractable: two of the three
repair layers the plugin needed for Zotero's segmenter — 457 lines putting back
a page's first line, 94 lines detecting equation source embedded at font size
zero — are PDF-only and need not be written yet. The third, rejoining a
paragraph cut mid-sentence, is 154 lines and is still needed.

The existing repair layers and the `test/fixtures/` directory, which holds real
constructed cases for CJK, Romanian diacritics, angle brackets and numbers, are
the test suite for the new segmenter. They are the accumulated record of where
sentence splitting actually goes wrong, and are worth more than the code.

Because the segmenter is `sentencex` and Zotero's is SDT, the two products do
**not** split text into the same utterances. This rules out any cross-product
reading position that identifies its place by counting utterances: the two sides
would count differently. How a position is expressed instead is a separate,
still-open decision.

## Amendment (#184, #189, #192): what the page reports as one Block

Three things the walk in `highlighter.ts` did turned into sentences the owner heard wrong. Measured over 257 distinct EPUBs on the development Mac (by SHA-256), each XHTML file passed through the walk cut out of `highlighterSource()`, with `display` taken from the tag and no stylesheet, then through the real `segmentDocument`:

- **List items and cells were rejoined.** `roleOf` calls `LI`, `DD`, `DT`, `TD` and `TH` paragraphs, and the rejoin layer joins two paragraphs when the first ends without a terminator and the second starts in lowercase. A list of lowercase phrases passes both tests, and the join chains: "lower cost faster startup fewer moving parts", and a table of 800 vocabulary cells became one sentence of 7,089 characters. 67 of the 257 books had a sentence joined across two items, 5,337 sentences, the longest 3,066 characters. Narrowing the role to `P`, `BLOCKQUOTE` and `DIV` would have caught 55 books and 3,021 sentences: in `<li><p>…</p></li>` the Block is the `<p>`. So the walk numbers every list item, definition-list entry and table cell (by tag, or by a computed `list-item` or `table-cell`) and each Block reports the one it is in as `item`; `rejoin.ts` refuses two Blocks whose `item` differs. Two Blocks inside one item may still be joined, so a book laid out inside one table cell keeps the repair.
- **A floated drop cap was a Block of its own.** WebKit computes `display: block` for a floated or absolutely positioned span (CSS 2.1 section 9.7; measured in an offscreen `WKWebView`, #189), and the walk closed the paragraph around it: Chapter I of the Gutenberg Pride and Prejudice was read "I", then "T is a truth universally acknowledged". The same split gave one paragraph two Blocks with one CFI, which resumes at the wrong sentence (#194). An element out of the line is now walked as part of its line's Block when a sibling in the line holds text. Without that condition, a converted book that sets each line in an absolute box would have become one Block per section; with it, those lines stay Blocks of their own.
- **A `<br>` with no white space beside it joined two lines.** The walk takes text from text nodes only, so `Chapter 1:<br/>Nightmare Begins` became `Chapter 1:Nightmare Begins`. 64 of the 257 books had such a break and 23 joined two letters or digits, among them every chapter heading of three Chinese web novels (`第9章<br/>下崖`: 2,059, 1,296 and 1,023 headings). The walk now puts one newline in the Block's text there, held by no text node, and only where neither side has white space, so every other Block's text is unchanged.

Against the walk before, the new one gives 32,390 of 6,186,126 sentences that the old one did not, in 117 of the 257 books, and no sentence joined across two items. Every sentence that changed is one a Download may have saved under its old text; ADR 0027's amendment for #184 says what happens to those.

#194 is only partly answered here. A formula, a block-displayed image, a rule or a nested list between two runs of one element's text still leaves two Blocks with one CFI; telling them apart needs a locator of their own, which touches the Reading Position format shared with Zotero-OpenReader (ADR 0008, ADR 0031).

## Amendment (#182, #185): the declared language is read by its form

`sentencex` 0.4.2 finds a language's rules only by an exact key: one of 30 bare lowercase codes (`src/languages/index.js`), else one of the 241 lowercase keys of `fallbacks.json`, walked recursively, else English (`getLanguageClass`, `src/index.js:5-17`). The EPUB's `dc:language` reached it as written, so a tag with a region, in capitals or with an underscore was split by the English rules: under `de-DE`, `DE` or `de_DE`, "Er wurde am 3. Oktober 1990 in Berlin geboren." was two sentences, and under `el-GR` the Greek question mark ended none. The walk keeps no record of where it has been, and `nan` falls back to `cdo` first and `cdo` to `nan`, so a Document declared either ran the stack out at its first section with text. The lookup also tests keys with `in`, so a tag that names a member of `Object.prototype` fails as a class.

`splitWithSentencex` now resolves the tag before the package sees it (`sentencexLanguage`, memoized per tag): trimmed, lowercased, `_` read as `-`; the whole tag when it has rules; else its primary subtag when that has; else English for `nan` and `cdo`, where the table's next entry, `zh-hant`, ends anyway; else the tag, which the package walks as before. A tag that still makes the package throw is English. This reads the tag and never the text, so it is not the detector this ADR keeps out. The core segmenter still hands the tag through untouched; mapping it onto one package's keys belongs to the binding.

Over every key of `fallbacks.json`, the answer differs from the table's own walk for five only: `kk-arab`, `kk-cn`, `kk-kz`, `kk-latn` and `kk-tr` fall back to `kk-cyrl`, which 0.4.2 has no rules under, so the table ended them at English; by the primary subtag they get the Kazakh rules `kk-cyrl` points at. `nan` and `cdo` are the only keys whose walk returns to itself (`test/core/segmenter/language.test.ts`).

Over 254 distinct EPUBs on the development Mac (by SHA-256), the declared languages were `en` 105, `zh` 85, `en-US` 27, `us` 16, `zh-CN` 13, `en-GB` 3, `en_US` 2, `ro` 1, `EN-US` 1 and `en-gb` 1. 47 of them (18.5 %) are written in a form other than a bare lowercase code; every one resolves to the same rules as before, English or English by fallback. So the change alters the sentences of none of those Documents, and no re-preparation was added, unlike the walk's change in ADR 0027's amendment for #184. What is given up: a chapter of a Document whose split does change, Downloaded before this, keeps the sentences it was prepared with and its check; a Reading asks for a sentence whose cut changed by its new text, misses its saved Clip and asks the Provider, and with no network stops there.
