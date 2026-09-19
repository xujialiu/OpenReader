---
status: accepted
---

# EPUB first, with formats kept pluggable

Only EPUB is read at first. PDF and HTML are expected later, so nothing in the
wire formats or the core is allowed to assume EPUB: a document records which
format it is, and a reading position stays opaque to everything except the
renderer that produced it.

This is recorded because several designs look over-general for an EPUB-only app
and a later reader would be tempted to simplify them.

The product argument is in `docs/design/0007-epub-first-other-formats-later.md`.

## Consequences

Deferring PDF defers the hardest problem in the project rather than solving it.
Telling body text from headers, footers and citations, and following a paragraph
across columns and pages, is work the desktop plugin explicitly refused —
"Zotero maintains it for more than Read Aloud, and redoing it would be a project
of its own" — and on a phone there is no Zotero to do it. That project is still
waiting whenever PDF arrives.

Keeping formats pluggable also argues for rendering documents in a WebView,
since pdf.js and epub.js both live there: one bridge serves every format, rather
than a separate native renderer per format.

For EPUB specifically, positions are already interoperable in principle. The
desktop plugin stores an EPUB position as `{ value: <cfi> }`, and Zotero's
reader resolves CFIs with epub.js's own `EpubCFI`, so a phone reader built on
epub.js speaks the same dialect. Whether a CFI actually round-trips between the
two is a separate open question: the plugin never generates a CFI of its own,
because Zotero's generator and resolver disagree about text steps.
