---
status: accepted
---

# Decisions and findings are recorded separately

This repo keeps both conventions: `docs/adr/` for why the project is built the way
it is, and dated files in `notes/` for what was measured. `CONTEXT.md` is a
glossary and holds neither.

## Why not just one, as in the Zotero-TTS repo

That repo appears to have chosen already: `notes/DECISIONS.md` holds three
entries, while the dated notes run to roughly 800 KB across 28 files. But the
split there is not decisions-versus-nothing — it is that the *findings* went to the
dated notes and the decisions were mostly implicit in the code.

And those findings are what made this project's planning possible. Everything
worth knowing about provider behaviour — that a local Kokoro server speaks `29.83`
as words and so breaks any aligner that searches from a cursor, that Azure's
preview voices emit dozens of zero-duration word boundaries after about nine and a
half seconds, that one provider documents MP3 and returns WAV, that a zero-byte
success cached under a text key poisoned all 152 identical separators in one
book — is in a dated note and none of it is in `DECISIONS.md`.

The two answer different questions, at different moments. A finding is written
after measuring something. A decision is written when a genuine alternative is
turned down, and is worth recording only when reversing it would be costly, when a
later reader would wonder why, and when there really was a choice.

## Consequences

A new project has an unusually high ratio of decisions to findings, because
nothing is built yet and everything is still a choice. Fourteen ADRs before the
first line of code is not a new convention taking over; it is the front-loading
that a greenfield project does. As the app starts running, the ADRs will slow and
the dated notes will grow, converging on the proportion the plugin repo already
shows.
