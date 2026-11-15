---
status: accepted
---

# Body Text evidence excludes identifiable non-body text

This revises [ADR 0030](0030-font-size-is-the-owners-and-scales-everything.md)'s sampling and cache, not its global Font Size or proportional stylesheet. In #363, Atomic Habits' copyright page and Contents supplied 2,011 characters before any prose. The 2,000-character threshold accepted the Contents' 12px as Body Text; the actual prose was 15.008px, so Font Size 24 produced 30.016px. More front matter can defeat any fixed threshold: eligible evidence, not a larger number, is the correction.

## What is counted

The existing `sizesOf` walks the same Blocks and text nodes as before. A text node does not contribute size evidence when it is inside:

- an actual hyperlink (`a[href]`), a heading, navigation, an aside, a header/footer or a figure caption;
- explicit EPUB types for Contents/navigation, title/copyright/cover pages, dedication/epigraph, notes, bibliography/index or colophon;
- the corresponding ARIA navigation, heading or Digital Publishing roles.

A memoized ancestor check shares its answer across nested inline elements. Empty/non-link anchors, inline emphasis, bare div prose, RTL and short paragraphs stay eligible. No filename, publisher class, language, sentence punctuation or minimum paragraph length is guessed.

The Document's own centered/right-aligned text is not evidence either. The sampler uses the original-alignment mark that `ensureStyle` already captures before installing Appearance, with the computed value for a body-level alignment. It checks the text's own element, not the alignment of every ancestor: left-aligned prose inside a centered container must still count.

Exclusion affects measurement only. All Blocks, verbatim text, offsets, CFIs, narration and the Document's formatting survive unchanged. The majority-size decision, per-section replacement, once-per-Document lifetime, 2,000-character threshold, rounding and text-size-adjust CSS are unchanged.

## The bound includes rejected characters

Both loops still stop at the text node that reaches 5,000 scanned non-space characters. Rejected text is charged to that bound too; otherwise a long Contents could turn a bounded sample into a whole-section search. A section beginning with 5,000 excluded characters may contribute no evidence. The next rendered prose section can decide; no new up-front EPUB scan is started.

## Cached answers must be remeasured

`Documents/body-text-sizes.json` advances from version 1 to version 2. Version-1 answers may have been permanently decided from front matter and carry no evidence that could distinguish good answers from bad ones, so none is reused. They are remeasured when their Document next opens. A version-2 write keeps other version-2 answers but does not carry any version-1 entries forward. Appearance, Reading Positions, the Library and Offline Narration are not migrated or removed.

A missing or invalid cache still costs measurement rather than preventing reading. A remeasurement can cause one first-open redraw; reopened Documents use their corrected value on first paint.

## Evidence and limits

Behavioral tests run the production adopt → sizesOf → Blocks message → countPage path on the stand-in page, including the original failure's character-count shape and old-cache rejection. They test eligibility/decisions, not WebKit layout.

The original-EPUB mobile WKWebView replay, with its diagnostic prose-only shortcut removed, yields 23.996803px for Atomic Habits and 24px for My Vampire System at Font Size 24. The 0.003197px difference comes from the existing hundredth-pixel baseline rounding (15.008 → 15.01). The replay uses stand-in rendition/manager boundaries and is not full-app or physical-device acceptance.

Unmarked non-body text styled as ordinary prose can still look like Body Text; a Document lacking enough eligible text stays against the existing 16px assumption. This is an evidence filter, not a semantic guarantee for arbitrary markup. Flattening all sizes, scanning the entire EPUB on open and hard-coded book exceptions remain rejected.
