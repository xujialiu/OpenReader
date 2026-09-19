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
