---
status: accepted
---

# Decisions, findings and the product argument are recorded separately

This repo keeps three: `docs/design/` for the trade-off as someone who does not read
code would need it, `docs/adr/` for the technical decision and the measured facts
that forced it, and dated files in `notes/` for what was measured and when.
`CONTEXT.md` is a glossary and holds none of them.

`docs/design/` and `docs/adr/` are paired by number — `docs/design/0002-…` and
`docs/adr/0002-…` are one decision written for two readers — and not every
decision has both halves. The rule for which half a sentence belongs to is
mechanical: strip every API name, file path, type, library and version from it,
and if it stops making sense it is an ADR sentence.

## Why a third kind, when two already worked

Because the two audiences were reading past each other. An ADR that opens by
arguing which product this should be, and closes on the byte layout of a WAV
header, is read fully by nobody: the person deciding what to build skips it for
the header, and the person building it skims the argument they already accept.
Splitting them costs a second file and buys each reader a document that is
entirely for them.

The risk of the split is real and worth naming, because it is the failure this
repository would actually have: **a measured detail paraphrased away while being
moved.** The ADRs are the most carefully written thing here, and their value is
concentrated in sentences that read like pointless caveats — that a provider
speaks `29.83` as words, that a library's own default is the value its own guard
rejects on the next line. When a decision is split, those sentences do not move
and are not rewritten. The design file is **new writing**, not a translation.

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
