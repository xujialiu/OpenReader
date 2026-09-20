---
status: accepted
---

# Explicit offline narration outlives the reader

The product agreement is [design 0027](../design/0027-whole-document-offline-narration.md). Ordinary playback remains memory-only; only explicitly selected download tasks persist audio. This extends ADR 0002's deferred whole-document preparation without introducing automatic disk caching of everything heard.

## One extraction and one synthesis identity

Chapter names and hierarchy are read from the EPUB container, OPF and EPUB 3 navigation or EPUB 2 NCX through archive range reads. This does not inflate chapter bodies, render the book or synthesize speech. A metadata-only plan is sufficient for selection; it is not a claim that speech text or whole-document coverage is already known.

After Download selected, the scheduler asks an isolated EPUB rendition to prepare the selected chapter's spine file using the exact computed-style DOM walk in `highlighter.ts`. It then synthesizes that chapter before preparing the next. Chapters sharing a file reuse its one extraction; selecting a late chapter never requires rendering all earlier sections. The rendition stays mounted across requests for the same active document, with a separate ReaderProvider and renderer cache directory, so preparation cannot move the visible reading or replace its HTML. Navigation anchors divide the resulting utterances into chapters; they do not change sentence boundaries. `segmentBlocks` and `splitWithSentencex` are shared with playback. A separate XML body-text extractor remains rejected because authored `display` rules decide block boundaries and hidden text; a different sentence would miss the saved clip even if the interface claimed the chapter was complete.

The first implementation published the chapter list only after extracting every spine file. The owner's long-book screenshot showed an empty selector at 624 sections read while Contents was already usable. Issue #6 removes that dependency: navigation metadata is read first, and body preparation belongs to the requested download rather than opening its controls. Metadata includes all unlisted spine files and possible text before a leading fragment; empty parts are excluded once actually inspected. Whole-document completion requires every section to have been prepared and all its speakable text saved, never merely all presently prepared rows.

The isolated Reader must also disable the library's independent location scan. Its installed template starts `book.locations.generate(1600)` unless `initialLocations` is truthy, even when `waitForLocationsReady` is false. That generator loads every linear spine member; looking only at our `preparedSections` would miss this unrelated work. The published `initialLocations` type is `ePubCfi[]`, but `useInjectWebViewVariables` actually interpolates JavaScript source without JSON serialization: an empty array emits `const initialLocations = ;`, while the source string `'[]'` emits a valid empty array and takes `book.locations.load([])`. The preparation-only adapter supplies that stable source value through an explicit type boundary. A regression test executes the actual installed template's initialization branch and checks that `load([])` runs and `generate()` does not. The visible reader is unchanged.

The clip key remains provider, voice and exact utterance text, independent of playback speed. Documents own their saved clips and deletion. Preparation and playback share a bounded memory store and an in-flight synthesis map. Persistent audio is consulted before credentials or enabled-provider checks, so already-paid audio does not become unusable when a provider is disabled or a key is removed.

## Persistence and lifecycle

Versioned plans and tasks live in the app-owned offline-narration directory. Version-1 fully prepared plans remain readable with the same chapter and clip identities. Version-2 plans separate metadata and preparation state from per-section text files; preparing each chapter therefore does not rewrite all previously extracted text. A section payload is saved before its prepared marker. Each audio payload is committed before its metadata; the metadata records its actual byte length and supplied word timings. iOS writes JSON atomically and excludes the directory from backup. PCM is stored as Apple Lossless, preserving sample counts and word-timing alignment rather than introducing an encoder-delay correction. Already encoded provider audio is preserved. The non-iOS fallback compresses PCM losslessly with gzip; native Android background execution is not provided by this iOS module.

One scheduler prepares documents in insertion order, yields to playback, and retains completed clips on pause, interruption and restart. Bounded retry applies to transient failures; authentication, quota and storage failures require explicit continuation. Missing playback audio blocks the queue instead of skipping unheard text. Explicit Play retries the missing utterance.

iOS uses a bounded UIApplication background task and an NWPathMonitor. Expiration marks preparation interrupted and retains its progress; returning to the foreground resumes it. No silent audio is used to extend execution. This does not promise that a whole long document finishes while the app stays backgrounded or after a force quit.

## Display names

Explicit names are recorded in `display-names.json`, keyed by Document Id, and shown in the existing catalogue title. EPUB metadata cannot overwrite an explicit name. The shared catalogue format gains no fields, following ADR 0003's sibling-file rule; neither document identity nor the original EPUB is changed.
