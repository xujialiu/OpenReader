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

Over 254 distinct EPUBs on the development Mac (by SHA-256), the declared languages were `en` 105, `zh` 85, `en-US` 27, `us` 16, `zh-CN` 13, `en-GB` 3, `en_US` 2, `ro` 1, `EN-US` 1 and `en-gb` 1. 47 of them (18.5 %) are written in a form other than a bare lowercase code; every one resolves to the same rules as before, English or English by fallback. So the change alters the sentences of none of those Documents, and no re-preparation was added, unlike the walk's change in ADR 0027's amendment for #184. What was given up then: a chapter of a Document whose split does change, Downloaded before this, kept the sentences it was prepared with and its check; a Reading asked for a sentence whose cut changed by its new text, missed its saved Clip and asked the Provider, and with no network stopped there. The sentence-rule revision below now invalidates that old preparation too.

## Amendment (#240, #245, #241, #242): bounded repairs to the pinned splitter

The pin understated its cost: ordinary English sentence-final words such as `no` and `me` are in the abbreviation table, and the base rule refuses a boundary before an immediately following ASCII digit or lowercase letter even after `。`. `segmentDocument` and `sectionChapters` reproduced both, and direct calls of the package returned the same wrong pieces. ASCII `...` and `. . .` also cut a continuing thought, unlike `…`. German's own continuation override already keeps the tested ellipsis whole; this was not a defect in every language. Three-letter `deu` and `ger` never reached the German rules, whereas `de` and `de-DE` did.

The MIT JavaScript package stays at 0.4.2, with owner-written changes in `patches/sentencex+0.4.2.patch`. Both published exports are minified single lines, so the patch is large despite the small rule changes. It patches the readable source and the actual CJS and ESM exports, removes their now-invalid source-map references, and changes no dependency or package entry. `test/core/segmenter/boundaries.test.ts` runs the same examples through the source classes, both exports, Reading and Download. A source-only patch would pass the source checks and fix nothing shipped.

- `。！？` do not run the ASCII digit/lowercase continuation check. The later quote, parenthesis and email-range checks still apply; quoted Chinese speech and the known angle-bracket faults are not silently redesigned here.
- English's `arc`, `ark`, `art`, `con`, `fed`, `fig`, `id`, `ill`, `man`, `mar`, `mass`, `may`, `me`, `miss`, `no`, `ok`, `ore`, `pa`, `rep` and `wash` may end a sentence before a whitespace-separated capitalized word. Numeric references keep the abbreviation path; `Art. IV` and `No. VI` keep their Roman numeral too, but a lone `I` is not enough evidence, so `No. I stayed.` splits. Capitalized titles and state abbreviations before names remain abbreviations (`Rep. Smith`, `Mass. General Hospital`, `Wash. Post`), with common pronouns and sentence starters excluded. Other abbreviations, initials and unit cases retain their old behavior. This is a bounded prose heuristic, not a general English parser: ambiguous abbreviations outside this set remain the pin's cost.
- A spaced ASCII ellipsis is matched as one run, never three lone full stops. Boundary lookahead begins after the complete punctuation match, not its first character. An ellipsis or a run of `!`/`?` before a lowercase continuation stays inside its sentence; a capitalized next sentence retains its boundary. Unicode lowercase letters and line whitespace are covered without replacing punctuation in the source.
- `sentencexLanguage` reads the existing `LANGUAGE_ALIASES` table for three-letter primary subtags, but takes an alias only when it names one of the package's own rule sets. Bibliographic and terminologic forms, capitals and regions therefore reach the same rules. Other ICU aliases and the package's fallback walk stay unchanged, including the cycle guard. No language is detected from prose.

All pieces remain slices of the original text. The existing forward-only location and grapheme checks therefore still supply UTF-16 offsets, including repeated sentences, emoji and combining marks. Neither the EPUB nor the Reading Position wire format changes. Changing a cut does change a Clip's text identity: `SEGMENTATION` in `core/segmenter/revision.ts` now versions these rules independently of `BLOCK_WALK`. ADR 0027 records the required re-preparation and the cost to existing Downloads. A wholesale splitter replacement, normalization of the original punctuation, and a change to quotes/brackets were rejected as larger and harder to verify than these repairs.

## Amendment (#183, #244, #243, #247): brackets pair by type, an inch mark is no quotation mark, a citation bracket alone continues nothing

Measured over 107 EPUBs on the development Mac, mostly long web novels, with Blocks from a script that approximates the page walk: 2,052,495 Utterances in 23,097 sections. With the rules before this amendment, 223 bracket groups were cut at a sentence end inside them, all `<…>` (180 in one book, `<You have absorbed enough Qi for a breakthrough!>`); 152 rejoined runs had a later Block opening with a bracket and a digit (127 in one book, system lines such as `[Reward 5 Exp]` then `[80/100 Exp]`); 12 Utterances were merged across an inch mark (`(5’6" tall)`); a `<` merged sentences twice, both in scraped HTML residue. With these rules the counts are 0, 2, 0 and 0. 243 sections change, and the number of Utterances over 1,000 characters stays 52. About ten of the changed sections read worse, all in one book whose source closes `{` with `)` and `(` with `}`, which the old any-to-any pairing held together. No group with a line break inside it was cut in either run.

The cause of #183 and #244 was one pattern, `Language.parensRegex`: any of `\ ( （ < { [` closed on the first of `\ ) ] } ）`, with no `>` and no `【】`. The bracket stripper (`prepareSpeechText`) pairs by type and works on one Utterance, so a group the splitter cut kept a bracket in each half. The patch now pairs by type, from a fixed table: `()`, `（）`, `[]`, `［］`, `{}`, `｛｝`, `【】`, `〖〗`, `〔〕`, `〈〉`, `<>`, and the backslash pair upstream had. A group may hold one group of its own kind (`[10 points spent. [Haste] obtained.]`) and ends at a line break, as upstream. `<` and `>` are brackets only where `readsAsSign` in `core/speech-text.ts` would strip them: not spaced on both sides, not between ASCII letters or digits, not next to `=`, and `>` not after `-`. The table does not follow the Bracket pairs setting: the splitter would then move sentence boundaries, Reading Positions and Downloaded text whenever the setting is edited. A group with sentence ends inside it is one Utterance, as a quotation already is, so a long bracketed thought is highlighted and skipped as one piece. Letting a group cross a line break was rejected: an unclosed bracket would then swallow the lines after it.

`quotesRegex` keeps upstream's pairs except: a straight `"` directly after a digit opens nothing, a straight `"` after a feet-and-inches figure (`\d['’′]\d{1,2}`) closes nothing, and a space and `'` before a digit (`'90s`) or a clipped word (`'em`, `'cause`, `'tis` and nine more, either case) opens nothing. Two broader rules were tried over the same corpus and rejected. Refusing every `"` after a letter as an opener cut nested straight quotes, `"I’m feeling a "but" incoming." Morok sighed.`, and moved the closing quote to the start of the next Utterance. Refusing a `'` between letters as a closer changed the single-quoted thought speech of a whole book, in about 490 sections.

`CONTINUES` in `rejoin.ts` no longer accepts a bracket and a digit by themselves. A bracket group continues the previous Block only when a lowercase word follows it, perhaps after `,`, `;` or `:`. `[66] that` and `(12) or` still join; `[2] Doe A, Science 7` and `[80/100 Exp]` do not.

The new patterns use lookbehind, one of variable length. Both patched exports and the built quote and bracket patterns compile with `hermesc` 250829098.0.17, the Hermes React Native 0.86.3 bundles; the ESM export only once its `export` statement is removed, which `hermesc` refuses outside module mode. `boundaries.test.ts` runs the examples through the readable source, both exports, Reading and Download. `SEGMENTATION` is 2, so Downloaded chapters whose text changed are rechecked under ADR 0027's amendment for #240.
